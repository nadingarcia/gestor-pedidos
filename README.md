# Gestor de Pedidos NexFood

Aplicativo desktop/web para operação de pedidos de restaurantes no ecossistema NexFood. A tela principal organiza os pedidos em Kanban, envia pedidos para a cozinha, imprime cupons térmicos, notifica o cliente pelo NexBot e ajuda a operação de entrega com motoboy próprio ou Box Delivery.

## Funcionalidades

### Operação de Pedidos

- Kanban por status: `Recebido`, `Em preparação`, `Saiu para entrega` e `Entregue`.
- Aceitação automática opcional de novos pedidos.
- Atualização automática configurável.
- Cards com cliente, tipo de pedido, pagamento, totais, desconto, entrega e alertas.
- Modal completo do pedido com itens, adicionais, observações, endereço e histórico operacional.
- Separação de pedidos Pix pendentes/recusados para evitar produção antes da confirmação.
- Cache local dos pedidos do dia para reduzir tela vazia e apoiar leitura durante instabilidade.
- Indicadores de operação: pedidos atrasados, Pix recusado, NexBot offline, Box Delivery, motoboys e modo cache.

### Impressão

- Impressão direta via Electron em impressoras instaladas no computador.
- Cupom térmico em 72 mm com dados do restaurante, cliente, itens, totais, pagamento e desconto.
- Seleção de impressora padrão.
- Impressão automática ao aceitar pedido, quando configurada.
- Reimpressão manual pelo card.
- Cupom de teste.
- Ajuste de fonte e opção de negrito para compatibilidade com impressoras térmicas.
- Etiquetas de sacola com quantidade configurável por pedido.

### Cozinha

- Display de cozinha em janela separada.
- Envio automático dos pedidos `Em preparação` para a tela da cozinha.
- Agrupamento por tipo de preparo.
- Modo "somente cozinha" para ocultar informações comerciais.
- Marcação local de itens prontos.
- Janela em tela cheia ao abrir pelo Electron.

### Entrega

- Agrupamento de pedidos próximos por distância, raio, janela de tempo e capacidade da bag.
- Painéis flutuantes para clusters de rota.
- Avanço de pedidos agrupados.
- Link de rota no Google Maps pelo modal.
- Integração com Box Delivery para chamar/cancelar entrega quando habilitada no restaurante.
- Integração com app de entregador NexFood para consultar motoboys disponíveis e atribuir entrega.

### NexBot e Notificações

- Indicador de status do NexBot/WhatsApp.
- Notificação ao cliente quando o pedido muda de status.
- Notificações nativas do sistema operacional para novos pedidos.
- Som de notificação com preload.
- Clique na notificação foca a janela principal.

### Desktop

- Aplicativo Electron para Windows, macOS e Linux.
- Instância única: abrir outra instância foca a janela já aberta.
- Auto-launch opcional ao iniciar o sistema.
- Auto-update via GitHub Releases/electron-updater.
- Bloqueio de suspensão de tela durante a operação.
- Aceleração de hardware desativada para evitar falhas de GPU no Linux.

## Rotas

- `/login`: autenticação do restaurante.
- `/pedidos`: painel principal protegido por token.
- `/kitchen`: display da cozinha.

## Pré-requisitos

- Node.js 24 recomendado.
- npm.
- Conta/restaurante válido no painel NexFood.
- Para impressão desktop: executar pelo Electron e ter a impressora instalada no sistema operacional.

## Instalação

```bash
git clone https://github.com/nadingarcia/gestor-pedidos.git
cd gestor-pedidos
npm install
```

## Desenvolvimento

```bash
# Web/Vite
npm run dev

# Electron + Vite
npm run electrondev

# Lint
npm run lint

# Build web
npm run build

# Preview do build web
npm run preview
```

## Build Desktop

```bash
# Build Electron para a plataforma atual
npm run electron:build

# Windows
npm run electron:build:win

# macOS
npm run electron:build:mac

# Linux
npm run electron:build:linux
```

Os artefatos são gerados em `release/`.

## Release por Tag

O workflow `.github/workflows/release.yml` roda em `windows-latest` quando uma tag `v*` é enviada. Ele instala dependências com `npm ci`, executa `npm run build` e publica com `electron-builder --win --publish always`.

Exemplo de release:

```bash
npm version patch --no-git-tag-version

git add package.json package-lock.json
git commit -m "chore: bump version"

git tag -a v1.0.27 -m "v1.0.27"
git push origin main
git push origin v1.0.27
```

## Estrutura

```text
gestor-pedidos/
├── electron/
│   ├── main.js          # Processo principal do Electron
│   └── preload.cjs      # Bridge segura para IPC
├── public/
│   ├── logo.png
│   └── icon-192.png
├── src/
│   ├── components/
│   │   ├── ClusterFloatingCard.jsx
│   │   ├── PedidoTeste.js
│   │   └── ProtectedRoute.jsx
│   ├── hooks/
│   │   ├── useNexBotStatus.jsx
│   │   └── useOrderClustering.jsx
│   ├── pages/
│   │   ├── KitchenDisplay.jsx
│   │   ├── Login.jsx
│   │   └── OrderManager.jsx
│   ├── utils/
│   │   ├── apiFetch.js
│   │   ├── electronBridge.js
│   │   ├── nexBotNotify.js
│   │   └── orderType.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── .github/workflows/release.yml
├── package.json
├── tailwind.config.js
└── vite.config.js
```

## Tecnologias

- React 18
- React Router
- Vite
- Electron
- electron-builder
- electron-updater
- Tailwind CSS
- Font Awesome
- Auto Launch
- ESLint

## API Utilizada

Base atual: `https://painel.nexfood.app/api`.

- `POST /login`: autentica restaurante.
- `POST /refresh-token`: renova token expirado.
- `GET /pedidos/dia`: lista pedidos do dia.
- `GET /pedidos/:id`: consulta pedido.
- `PATCH /pedidos/:id/status`: atualiza status do pedido.
- `POST /pedidos/:id/box-delivery`: chama Box Delivery.
- `POST /pedidos/:id/box-delivery/cancel`: cancela chamada Box Delivery.
- `GET /motoboy/fila?restauranteSlug=...`: lista motoboys disponíveis.
- `POST /motoboy/atribuir-entrega`: atribui motoboy ao pedido.
- `GET /bot/restaurant/status`: consulta status do NexBot.
- `POST /bot/restaurant/order-status`: notifica cliente via WhatsApp/NexBot.

As chamadas autenticadas usam `Authorization: Bearer {token}` via `src/utils/apiFetch.js`.

## Configurações Locais

As preferências operacionais são salvas no `localStorage`, incluindo:

- impressora automática;
- aceitação automática;
- notificações e som;
- tempo de atualização;
- agrupamento por distância;
- endereço do restaurante;
- app de entregador;
- estilo do cupom;
- etiquetas de sacola.

O login pode salvar sessão em `localStorage` ou `sessionStorage`, conforme a opção "lembrar".

## Observações

- `VITE_API_URL` não é usado hoje no código; as URLs da API estão fixas em `https://painel.nexfood.app/api`.
- O script correto para desenvolvimento desktop é `npm run electrondev`.
- O Font Awesome está instalado como dependência do projeto.
- O release automático depende de `GH_TOKEN` configurado nos secrets do repositório.
