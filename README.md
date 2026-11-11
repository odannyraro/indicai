# Eleição da diretoria · ABU Beagá

Aplicação compartilhada para indicar pessoas a cargos, acompanhar respostas e administrar várias eleições.

## Como abrir

Use Node.js 20.19 ou superior. Copie `.env.example` para `.env`, configure `DATABASE_URL` se for usar o banco remoto, e execute:

```sh
npm ci
npm run build
npm start
```

Abra `http://127.0.0.1:8000`. A autenticação usa Neon Auth; configure `NEON_AUTH_BASE_URL` e `NEON_AUTH_JWKS_URL` no `.env` conforme `.env.example`. `DATABASE_URL` pode ficar vazio para desenvolvimento local; nesse caso, o armazenamento usa `data/election.json`. Não versione `.env` nem os dados locais.

A branch de produção não permite origens localhost. Para testar o login local, use uma branch Neon de desenvolvimento isolada e habilite localhost somente nela.

## Segurança e armazenamento

- Login, senhas e sessões são gerenciados pelo Neon Auth. O servidor valida os JWTs assinados pelo Neon antes de liberar as rotas administrativas.
- O cadastro público está desativado no Neon Auth. A conta proprietária do projeto Neon gerencia a criação e exclusão de usuários nas ferramentas de gestão de Auth do Neon; contas comuns não têm rotas de gestão de usuários.
- Toda conta criada no Neon Auth pode acessar o dashboard da eleição e alterar a própria senha, confirmando a senha atual; a troca revoga as outras sessões do Neon Auth. Um JWT já emitido pode continuar válido até expirar (15 minutos).
- As contas antigas `admin`/`dev` e seus hashes de senha não são migrados. Elas são removidas do estado da aplicação na próxima inicialização; crie usuários com e-mail no Neon Auth.
- O dashboard permite criar eleições, publicar uma eleição na página principal, abrir suas configurações e editar requisitos globais.
- Cada eleição tem calendário, cargos e indicações próprios; as regras para candidatos são globais.
- Links públicos `/?election=<id>` abrem uma eleição específica e podem ser compartilhados com os participantes.
- O servidor exige sessão administrativa para editar eleições, cargos, regras, acessar contatos e indeferir candidaturas.
- Contatos não são enviados a usuários sem sessão administrativa.
- Com `DATABASE_URL`, o estado compartilhado fica em PostgreSQL (uma linha JSONB), inicializado automaticamente. Na primeira inicialização, o servidor importa `data/election.json` se o arquivo existir; sem ele, inicia com os dados padrão. Sem `DATABASE_URL`, usa o JSON local para desenvolvimento.
- As alterações recebidas são persistidas antes de confirmar sucesso; o PostgreSQL mantém os dados entre reinicializações e permite que todos os visitantes vejam as mesmas indicações.
- A hospedagem gratuita do Render pode suspender o serviço quando ocioso e a primeira visita após a suspensão pode demorar. O PostgreSQL gratuito também tem limites de armazenamento/uso e pode suspender projetos inativos; confira os limites atuais do provedor.

## Deploy gratuito (Render + Neon)

O repositório está conectado ao projeto Neon `falling-credit-79519565` (São Paulo). O projeto Neon e o serviço Render gratuito são recursos distintos. Neon Auth está habilitado na branch `main`, com cadastro público desativado e o domínio Render confiável.

O repositório inclui `render.yaml` para criar o serviço web gratuito no Render. O banco PostgreSQL gratuito é provisionado no Neon; não é necessário usar GitHub Pages.

1. Use a URL de conexão **pooled** do Neon como `DATABASE_URL` no Render. Mantenha esse valor secreto.
2. No Render, crie um **Blueprint** a partir do repositório. O `render.yaml` instala dependências e empacota o cliente Neon Auth. Configure `DATABASE_URL`; as URLs públicas de Neon Auth já estão declaradas no Blueprint. Confirme em **Neon → Auth → Configuration → Domains** que a origem exata do serviço Render está autorizada (com `https://`, sem barra final).
3. Entre com a conta Neon Auth do proprietário do projeto. Para definir a senha inicial ou recuperar acesso, use **Esqueci minha senha** na tela de login. O cadastro público está desligado; crie cada conta adicional pelas ferramentas de gestão de Auth do Neon antes de compartilhar o acesso. Cada usuário usa e-mail e senha do Neon Auth, e pode alterar a própria senha pelo dashboard do app.
4. Antes de abrir o site ao público, configure um provedor SMTP próprio no Neon para entrega confiável de mensagens. O SMTP compartilhado é limitado e destinado a desenvolvimento.

O arquivo local `data/election.json` não é versionado nem será copiado pelo Render. Se o banco Neon estiver vazio, o app inicia com os dados padrão; importe o arquivo para o Neon separadamente antes do deploy se quiser preservar eleições locais.

Não publique `.env`, `DATABASE_URL`, senhas ou `data/election.json` no GitHub.
