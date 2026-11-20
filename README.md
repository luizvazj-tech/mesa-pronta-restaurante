# Mesa Pronta

Sistema web para restaurantes: PDV de frente de caixa, comandas de salão e balcão, delivery, NFC-e opcional, estoque, ficha técnica, produção, financeiro, relatórios, assistente e controle de acesso.

Página estática única (`public/index.html`), sem build. Os dados ficam no navegador (localStorage) e o sistema funciona offline.

## Controle de acesso
Login por PIN com perfis (proprietário, gerente, operador de caixa, garçom, cozinha), autorização de gerente para descontos, cancelamentos e sangrias, bloqueio por inatividade e registro de auditoria.
PINs iniciais de demonstração (troque antes de usar): Proprietário 1234, Gerente 2345, Caixa 3456, Garçom 4567.

## Limites
- A emissão de NFC-e está em modo simulação. Para emitir de verdade, configure um provedor de emissão por API na aba Fiscal.
- A integração com o iFood é simulada.
- Como os dados ficam no navegador, o controle de acesso protege o uso no balcão, mas não substitui um servidor com login. Vários dispositivos sincronizados exigem backend e banco de dados.

## Publicação
Render, site estático: publish path `public`, sem comando de build.
