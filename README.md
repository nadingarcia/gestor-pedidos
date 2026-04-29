# 🍔 Gestor de Pedidos NexFood

Sistema profissional de gestão de pedidos para restaurantes com interface Kanban e funcionalidades desktop.

## ✨ Funcionalidades

### 📊 Dashboard Kanban
- **4 Colunas de Status**: Novos Pedidos → Na Cozinha → Em Rota → Finalizados
- **Atualização em Tempo Real**: Polling automático configurável (10-120s)
- **Cards Interativos**: Visualização rápida dos pedidos com detalhes principais
- **Modal de Detalhes**: Visualização completa do pedido ao clicar

### ⚙️ Configurações Avançadas
- **Impressora Automática**: Selecione a impressora para pedidos automáticos
- **Notificações Push**: Alertas de novos pedidos no desktop
- **Som de Notificação**: Aviso sonoro ao receber pedidos
- **Iniciar com Windows**: Abertura automática ao ligar o PC
- **Auto-Refresh**: Atualização automática configurável
- **Modo Escuro**: Interface moderna e elegante

### 🖨️ Sistema de Impressão
- Impressão direta de pedidos
- Suporte para impressoras térmicas
- Configuração de impressora padrão

### 🔔 Notificações
- Notificações nativas do sistema operacional
- Alertas visuais e sonoros
- Compatível com Windows, Mac e Linux

## 🚀 Instalação

### Pré-requisitos
- Node.js 18+ instalado
- npm ou yarn

### Passos

1. **Clone o repositório**
```bash
git clone https://github.com/seu-usuario/nexfood-gestor.git
cd nexfood-gestor
```

2. **Instale as dependências**
```bash
npm install
```

3. **Configure o Font Awesome**

O Font Awesome já está incluído no projeto via CDN no `index.html`.

4. **Execute em modo desenvolvimento**
```bash
# Apenas web
npm run dev

# Com Electron (desktop)
npm run electron:dev
```

5. **Build para produção**
```bash
# Build web
npm run build

# Build Electron (Windows)
npm run electron:build:win

# Build Electron (Mac)
npm run electron:build:mac

# Build Electron (Linux)
npm run electron:build:linux
```

## 📁 Estrutura do Projeto

```
nexfood-gestor/
├── electron/
│   └── main.cjs              # Processo principal do Electron
├── src/
│   ├── components/
│   │   └── OrderManager.jsx  # Componente principal
│   ├── utils/
│   │   └── electronBridge.js # Ponte para APIs do Electron
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── public/
│   └── logo.png
├── package.json
└── vite.config.js
```

## 🎨 Tecnologias Utilizadas

- **React 18**: Framework frontend
- **Vite**: Build tool e dev server
- **Electron**: Desktop application framework
- **Tailwind CSS**: Framework CSS utilitário
- **Font Awesome**: Biblioteca de ícones
- **React Router**: Roteamento SPA
- **Auto-Launch**: Inicialização automática com sistema

## 🔧 Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
VITE_API_URL=https://painel.nexfood.app/api
```

### Impressoras

O sistema detecta automaticamente todas as impressoras instaladas no computador. Para configurar:

1. Abra o menu de configurações (ícone de engrenagem)
2. Selecione a impressora desejada
3. A configuração é salva automaticamente

### Notificações

Para habilitar notificações:

1. Permita notificações quando solicitado pelo navegador/aplicativo
2. Ative "Notificações Push" nas configurações
3. Configure o som se desejar alertas sonoros

### Iniciar com Windows

1. Abra as configurações
2. Ative "Iniciar com Windows"
3. O aplicativo será aberto automaticamente ao ligar o PC

## 📋 API Endpoints Utilizados

- `GET /api/pedidos/dia` - Buscar pedidos do dia
- Headers necessários: `Authorization: Bearer {token}`

## 🎯 Roadmap

- [ ] Integração com WhatsApp Business
- [ ] Relatórios e estatísticas avançadas
- [ ] Suporte multi-loja
- [ ] Integração com iFood/Rappi
- [ ] Chat interno para equipe
- [ ] Modo offline com sincronização

## 🐛 Problemas Conhecidos

### Linux: Erro SIGSEGV/GPU
**Solução**: Já incluída no código - `app.disableHardwareAcceleration()`

### Notificações não aparecem
**Solução**: Verifique as permissões do sistema operacional para notificações

## 📄 Licença

MIT License - veja o arquivo LICENSE para detalhes

## 👥 Contribuindo

Contribuições são bem-vindas! Por favor, abra uma issue primeiro para discutir mudanças maiores.

## 📞 Suporte

Para suporte, envie um email para suporte@nexfood.com ou abra uma issue no GitHub.

---

Desenvolvido com ❤️ por NexFood Team
