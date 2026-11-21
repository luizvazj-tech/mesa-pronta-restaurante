# Mesa Pronta, backend na AWS

API multi-restaurante em AWS Lambda (Node.js 20), API Gateway HTTP API e DynamoDB.
Prova de conceito: cada restaurante cria a própria conta e os dados ficam isolados.

## O que existe
- Cadastro de restaurante (`POST /signup`), login por usuário e PIN (`POST /login`), bloqueio de 60 s após 5 PINs errados.
- Perfis (proprietário, gerente, caixa, garçom, cozinha) e autorização de gerente validada no servidor (`POST /authorize`).
- Sincronização entre computadores por cursor (`GET/POST /sync`), com estoque somado por variação (duas baixas simultâneas não se perdem).
- Número de venda atômico (`POST /counter`) e numeração de NFC-e atribuída pelo servidor (`POST /nfce/transmit`). O token do emissor fiscal fica só no servidor.
- Tabela única no DynamoDB: a chave de partição de cada restaurante vem do token de sessão, então uma consulta nunca sai da partição do próprio restaurante.

## Implantação
Pré-requisitos: conta AWS, AWS CLI configurada e AWS SAM CLI.

```
cd backend
sam build
sam deploy --guided
```
No assistente, escolha uma região (sugestão: `sa-east-1`, São Paulo) e informe em `AllowedOrigin` o endereço do site (por exemplo `https://mesa-pronta-w8li.onrender.com`). Ao terminar, copie a saída `ApiUrl` para `public/config.js`:

```
window.MP_API = 'https://xxxxxxxx.execute-api.sa-east-1.amazonaws.com';
```
Faça commit e publique o site. Para desativar novos cadastros use `--parameter-overrides SignupEnabled=false`.

## Testes (rodam sem AWS, com DynamoDB emulado)
```
npm install
npm test          # 26 verificações da API
npm run test:e2e  # 15 verificações com dois computadores simulados usando o sistema real
```

## Limites da prova de conceito
- O cadastro é aberto e limitado só por taxa no API Gateway. Falta verificar o e-mail do dono e proteger contra abuso (por exemplo AWS WAF).
- O servidor ainda não impede um usuário de gravar registros que o perfil dele não deveria alterar; as restrições de tela e de autorização de gerente são aplicadas, mas a validação por registro no servidor é uma etapa seguinte.
- Conflitos entre dois computadores editando o mesmo registro seguem "último a gravar vence". Estoque e numeração de venda são tratados à parte.
- Cada computador baixa todo o histórico de vendas do restaurante. Para operação longa é preciso limitar por período.
- Entrar com PIN exige conexão. Quem já está logado continua vendendo sem internet e as alterações sobem ao reconectar. Venda feita offline usa numeração local até sincronizar.
- NFC-e: o servidor numera e chama o provedor de emissão configurado. Falhas depois da numeração podem deixar buracos de numeração, que exigem inutilização junto à SEFAZ. A emissão real depende de contratar um provedor e ter certificado digital A1.
- O token do provedor fiscal fica no item do restaurante no DynamoDB (criptografado em repouso). Para produção, mova para o Secrets Manager por restaurante.
- Antes de operar com clientes reais, avalie LGPD, termos de uso e backup (o ponto no tempo do DynamoDB já está ligado no modelo).
