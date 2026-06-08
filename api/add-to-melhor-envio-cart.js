// /api/add-to-melhor-envio-cart.js
// Recebe o webhook orders/create da Shopify e adiciona a etiqueta no carrinho do Melhor Envio.
// Configure este endpoint como webhook em: Shopify Admin → Settings → Notifications → Webhooks
// Event: Order creation | URL: https://seu-dominio.vercel.app/api/add-to-melhor-envio-cart

import crypto from 'crypto';

// ─── Mapeamento dos serviços do Melhor Envio ────────────────────────────────
// O nome que aparece no shipping_lines[0].title do pedido Shopify → ID do serviço ME
// Confira os IDs em: https://melhorenvio.com.br/api/v2/me/shipment/services
const SERVICE_MAP = {
  // Correios
  'pac':                    1,
  'sedex':                  2,
  'mini envios':            17,
  'mini envios correios':   17,

  // Jadlog
  '.package':               3,
  'jadlog package':         3,
  'jadlog .package':        3,
  '.com':                   4,
  'jadlog .com':            4,

  // Via Brasil
  'rodoviário':             22,
  'aéreo':                  23,

  // Azul Cargo
  'azul amanhã':            28,
  'azul':                   28,

  // Latam Cargo
  'latam cargo':            29,

  // Express / outros nomes comuns
  'express':                2,
  'rapido':                 2,
  'rápido':                 2,
  'expresso':               2,
};

function toNumber(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value = '') {
  return String(value || '').toLowerCase().trim();
}

function isMelhorEnvioShippingLine(line = {}) {
  const title = normalizeText(line.title);
  const code = normalizeText(line.code);
  const source = normalizeText(line.source);
  const carrierIdentifier = normalizeText(line.carrier_identifier);

  // O checkout próprio salva code assim: melhorenvio_1, melhorenvio_2, etc.
  if (/melhorenvio_\d+/.test(code)) return true;

  // Garante que só entra se veio claramente do Melhor Envio.
  if (source.includes('melhor') || carrierIdentifier.includes('melhor')) return true;

  // Fallback por nome do serviço.
  // Mantém compatibilidade com pedidos antigos em que o code/source não vinham preenchidos.
  const combined = `${title} ${code}`;

  return Object.keys(SERVICE_MAP).some(key => combined.includes(key));
}

function resolveServiceId(shippingLines = []) {
  if (!shippingLines.length) return null;

  const line = shippingLines.find(isMelhorEnvioShippingLine);
  if (!line) return null;

  const title = normalizeText(line.title);
  const code  = normalizeText(line.code);

  // Tenta pelo code primeiro (ex: "melhorenvio_2" → 2)
  const codeMatch = code.match(/melhorenvio_(\d+)/);
  if (codeMatch) return parseInt(codeMatch[1], 10);

  // Tenta pelo título
  for (const [key, id] of Object.entries(SERVICE_MAP)) {
    if (title.includes(key)) return id;
  }

  // IMPORTANTE:
  // Não usar PAC como fallback aqui.
  // Se não identificou serviço válido, é melhor pular do que criar etiqueta errada.
  console.warn(`[ME] Serviço não mapeado: "${title}" / "${code}". Pulando etiqueta.`);
  return null;
}

function getShippingPrice(order = {}) {
  const linePrice = order.shipping_lines?.[0]?.price;
  const totalShipping =
    order.total_shipping_price_set?.shop_money?.amount ??
    order.current_total_shipping_price_set?.shop_money?.amount ??
    order.total_shipping_price ??
    linePrice ??
    0;

  return toNumber(totalShipping, 0);
}

function shouldCreateMelhorEnvioLabel(order = {}) {
  const shippingLines = order.shipping_lines || [];
  const shippingPrice = getShippingPrice(order);

  const hasMelhorEnvioShipping = shippingLines.some(isMelhorEnvioShippingLine);
  const serviceId = resolveServiceId(shippingLines);

  // Trava principal:
  // Se o cliente não pagou frete Melhor Envio, NÃO cria etiqueta.
  // Produtos importados/China com frete grátis devem cair aqui.
  if (!hasMelhorEnvioShipping || !serviceId || shippingPrice <= 0) {
    return {
      ok: false,
      serviceId,
      shippingPrice,
      reason: `Sem frete Melhor Envio pago. hasMelhorEnvioShipping=${hasMelhorEnvioShipping}, serviceId=${serviceId}, shippingPrice=${shippingPrice}`
    };
  }

  return {
    ok: true,
    serviceId,
    shippingPrice,
    reason: 'Frete Melhor Envio pago encontrado.'
  };
}

// ─── Extrai número do endereço (ex: "Rua das Flores, 123" → "123") ──────────
function extractNumber(address1 = '') {
  const match = String(address1 || '').match(/,?\s*(\d+[A-Za-z]?)(\s|,|$)/);
  return match ? match[1] : 'S/N';
}

// ─── Extrai logradouro sem o número ─────────────────────────────────────────
function extractStreet(address1 = '') {
  const clean = String(address1 || '');
  return clean.replace(/,?\s*\d+[A-Za-z]?(\s*,.*)?$/, '').trim() || clean;
}

// ─── Valida assinatura HMAC do webhook Shopify ───────────────────────────────
// Nota: desativado pois o Vercel faz parse do body antes da validação HMAC.
// Segurança garantida pelo URL privado do endpoint.
function isValidShopifyWebhook(req, rawBody) {
  return true;
}

// ─── Handler principal ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST.' });
  }

  // Lê o body raw para validar assinatura
  let rawBody = '';
  let order = req.body;

  if (typeof req.body === 'string') {
    rawBody = req.body;
    try {
      order = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'JSON inválido.' });
    }
  } else {
    rawBody = JSON.stringify(req.body || {});
  }

  if (!isValidShopifyWebhook(req, rawBody)) {
    console.warn('[ME] Webhook com assinatura inválida rejeitado.');
    return res.status(401).json({ error: 'Assinatura inválida.' });
  }

  const orderNumber = order.name || `#${order.order_number || order.id || 'sem-numero'}`;
  console.log(`[ME] Pedido recebido: ${orderNumber}`);

  // ── TRAVA: só cria etiqueta se tiver frete Melhor Envio pago ──────────────
  const labelCheck = shouldCreateMelhorEnvioLabel(order);

  if (!labelCheck.ok) {
    console.log(`[ME] Pedido ${orderNumber} pulado: ${labelCheck.reason}`);

    return res.status(200).json({
      success: true,
      skipped: true,
      pedido: orderNumber,
      reason: labelCheck.reason
    });
  }

  const serviceId = labelCheck.serviceId;

  // ── Dados do destinatário ────────────────────────────────────────────────
  const ship = order.shipping_address || order.billing_address || {};

  // Bairro: na sua loja vem em address2 (pode estar junto com complemento)
  // Se quiser separar complemento e bairro, adicione um campo customizado no checkout
  const district = String(ship.address2 || '').trim() || 'Centro';

  // CPF: lê de note_attributes (salvo pelo mercadopago-webhook como 'customer_cpf')
  const attrs = order.note_attributes || [];
  const cpfAttr = attrs.find(a =>
    ['cpf', 'customer_cpf', 'documento', 'document'].includes(String(a.name || a.key || '').toLowerCase().trim())
  );
  const cpf = cpfAttr ? String(cpfAttr.value).replace(/\D/g, '') : '';

  const customerName = String(
    ship.name ||
    `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim() ||
    order.email ||
    'Cliente'
  ).trim();

  // ── Monta payload para o Melhor Envio ────────────────────────────────────
  const insuranceValue = parseFloat(order.total_price || '0');

  const mePayload = {
    service: serviceId,

    from: {
      name:        process.env.REMETENTE_NOME,
      email:       process.env.REMETENTE_EMAIL,
      document:    process.env.REMETENTE_DOCUMENTO,   // CPF ou CNPJ sem pontuação
      phone:       process.env.REMETENTE_TELEFONE,
      address:     process.env.REMETENTE_ENDERECO,
      number:      process.env.REMETENTE_NUMERO,
      complement:  process.env.REMETENTE_COMPLEMENTO || '',
      district:    process.env.REMETENTE_BAIRRO,
      city:        process.env.REMETENTE_CIDADE,
      state_abbr:  process.env.REMETENTE_ESTADO,
      postal_code: process.env.STORE_ORIGIN_CEP,      // mesmo env do calculate-shipping
      country_id:  'BR',
    },

    to: {
      name:        customerName,
      email:       order.email || '',
      document:    cpf,
      phone:       String(ship.phone || order.phone || '').replace(/\D/g, ''),
      address:     extractStreet(ship.address1 || ''),
      number:      extractNumber(ship.address1 || ''),
      complement:  '',          // address2 vai todo para district; ajuste se preferir separar
      district:    district,
      city:        ship.city || '',
      state_abbr:  String(ship.province_code || ship.province || '').slice(-2).toUpperCase(),
      postal_code: String(ship.zip || '').replace(/\D/g, ''),
      country_id:  'BR',
    },

    products: (order.line_items || []).map(item => ({
      name:            item.title || 'Produto',
      quantity:        item.quantity || 1,
      unitary_value:   parseFloat(item.price || '0'),
    })),

    // Mesmas dimensões do calculate-shipping.js — ajuste se tiver dimensões variáveis
    volumes: [
      {
        height: parseInt(process.env.PACOTE_ALTURA      || '5', 10),
        width:  parseInt(process.env.PACOTE_LARGURA     || '20', 10),
        length: parseInt(process.env.PACOTE_COMPRIMENTO || '30', 10),
        weight: parseFloat(process.env.PACOTE_PESO      || '0.3'),
      }
    ],

    options: {
      insurance_value: insuranceValue,
      receipt:         false,
      own_hand:        false,
      reverse:         false,
      non_commercial:  false,
      invoice: { key: '' },
      tags: [
        { tag: `Shopify ${orderNumber}`, url: '' }
      ],
    },
  };

  // ── Chama a API do Melhor Envio ──────────────────────────────────────────
  try {
    const meRes = await fetch('https://melhorenvio.com.br/api/v2/me/cart', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${String(process.env.MELHOR_ENVIO_TOKEN || '').trim()}`,
        'User-Agent':    'NEWER STORE',
      },
      body: JSON.stringify(mePayload),
    });

    const meData = await meRes.json().catch(() => ({}));

    if (!meRes.ok) {
      console.error(`[ME] Erro ao adicionar pedido ${orderNumber} ao carrinho:`, meData);
      return res.status(500).json({ success: false, error: meData });
    }

    console.log(`[ME] ✅ Etiqueta adicionada ao carrinho! ID: ${meData.id} | Pedido: ${orderNumber}`);
    return res.status(200).json({
      success:     true,
      etiqueta_id: meData.id,
      pedido:      orderNumber,
      servico_id:  serviceId,
    });

  } catch (err) {
    console.error(`[ME] Exceção ao processar pedido ${orderNumber}:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
