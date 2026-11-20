# Mesa Pronta

Sistema web para restaurantes: comandas de salão e balcão, delivery, NFC-e opcional, estoque, ficha técnica, produção, financeiro, relatórios e assistente.

Página estática única (`public/index.html`), sem build. Os dados ficam no navegador (localStorage) e o sistema funciona offline.

## Limites
- A emissão de NFC-e está em modo simulação. Para emitir de verdade, configure um provedor de emissão por API na aba Fiscal.
- A integração com o iFood é simulada.
- Sincronização entre vários dispositivos exige backend e banco de dados.
