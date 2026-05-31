# BlueSky → Shopify Importer para Vercel

Automação de teste para importar produtos autorizados do BlueSky para a Shopify `newera-shop-7780`.

## O que essa versão faz

- Importa apenas 4 clubes no teste: Flamengo, Corinthians, Palmeiras e São Paulo.
- Cria os produtos como `draft`/rascunho.
- Coloca na coleção `Brasileirão`.
- Substitui a descrição pela descrição padrão da New Era Store.
- Cria variantes somente de tamanho: `P`, `M`, `G`, `GG`, `XGG`.
- Não usa SKU.
- Mantém venda sem controle de estoque (`inventory_policy: continue`).
- Preço padrão: `154.90`.
- Preço premium: `175.90` para produto retrô ou versão jogador.
- Importa imagens do produto, removendo imagens que pareçam tabela/guia de medidas.
- Gera tags como `brasileirao`, `flamengo`, `home`, `jogador`, `retro`.

## Regras de nome

Exemplos:

- `Flamengo Home 2025/2026 Jersey` vira `Camisa Flamengo Home 25/26`
- `Player Version Flamengo Home 2026/2027 Jersey` vira `Camisa Flamengo Home Jogador 26/27`
- `Retro Palmeiras Away 1999 Jersey` vira `Camisa Palmeiras Retro 1999`
- Qualquer modelo que não seja Home, Away, Third ou Retro vira `Special Edition`.

## Variáveis na Vercel

Crie essas variáveis em **Project Settings → Environment Variables**:

```env
SHOPIFY_STORE_DOMAIN=newera-shop-7780.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxx
IMPORT_SECRET=crie-uma-senha-forte-aqui
SHOPIFY_API_VERSION=2026-01
```

O token precisa ser de um app privado/custom app da Shopify com permissão de produtos. Recomendo escopos:

- `write_products`
- `read_products`

## Endpoints

### Testar sem criar produtos

Abra:

```txt
https://SEU-PROJETO.vercel.app/api/import-test?secret=SEU_SECRET&dry_run=true&limit=8
```

Isso mostra um relatório do que seria criado.

### Criar rascunhos de verdade

Depois de validar o relatório:

```txt
https://SEU-PROJETO.vercel.app/api/import-test?secret=SEU_SECRET&dry_run=false&limit=8
```

Aumente o `limit` aos poucos.

## Observação sobre personalização e patch

Para não criar 30 variantes por produto, esse importador cria variantes só de tamanho.

As opções abaixo são salvas em metafields do produto:

- Personalização: Sem Personalização / Personalização (+20)
- Patch: Sem Patch / Brasileirão (+15) / Libertadores (+27)

Para aparecerem na página de produto e somarem no carrinho, o tema precisa ler esses metafields ou usar line item properties. Se você quiser, o próximo passo é eu montar o trecho Liquid para mostrar essas opções no tema.

## Segurança

Nunca deixe `IMPORT_SECRET` vazio em produção.
