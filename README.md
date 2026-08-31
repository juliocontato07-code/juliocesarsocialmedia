# Júlio César - Social Media

Gestão de demandas de social media. Aplicação web multiusuário: servidor Node/Express,
banco Postgres, front em HTML, CSS e JavaScript puro servido pelo próprio servidor.

## Rodar local

```
npm install
cp .env.example .env     # e preencha
npm run dev
```

Sobe em `http://localhost:3000`, conecta no Postgres e aplica as migrações pendentes.

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Connection string do Postgres. Exige SSL. |
| `SESSION_SECRET` | Segredo dos cookies de sessão. Use um valor longo e aleatório. |
| `ADMIN_USUARIO` | Usado **uma única vez**, para criar o primeiro administrador. |
| `ADMIN_SENHA` | Senha desse primeiro administrador. |
| `PORT` | Porta do servidor. Padrão `3000`. |

`ADMIN_USUARIO` e `ADMIN_SENHA` só têm efeito quando a tabela `usuarios` está vazia.
Havendo qualquer usuário, são ignoradas — senão bastaria mexer no painel para recriar acesso.

O `.env` nunca entra no repositório.

## Migrações

Arquivos SQL numerados em `migrations/`, aplicados na inicialização, cada um dentro de uma
transação, com a versão registrada na tabela `meta`. Só aplica o que ainda não foi aplicado.

Regra que não se quebra: **o banco nunca é apagado nem recriado para aplicar mudança de
estrutura.** Mudou o schema, escreva uma migração nova com `ALTER TABLE`. Migração que falha
desfaz a transação, aborta a inicialização com erro visível e não altera dado nenhum.

Nada de estrutura é criado por fora dos arquivos de `migrations/`, para o banco de produção
continuar reconstruível a partir do repositório.

## Subir no Render

O [render.yaml](render.yaml) já descreve o serviço. No painel do Render, **New > Blueprint**,
aponte para o repositório e ele monta tudo: `npm ci`, `npm start`, Node 22, health check
em `/saude`.

O Render vai pedir três valores na hora de criar, porque estão marcados como `sync: false` —
ou seja, não moram no repositório:

| Variável | O que pôr |
|---|---|
| `DATABASE_URL` | a connection string do Neon, copiada do painel do Neon |
| `ADMIN_USUARIO` | o nome do primeiro administrador |
| `ADMIN_SENHA` | a senha dele |

`SESSION_SECRET` o próprio Render sorteia (`generateValue: true`), e `NODE_ENV=production`
já vai no arquivo. `PORT` não se cadastra: a hospedagem injeta.

`ADMIN_USUARIO` e `ADMIN_SENHA` só têm efeito com a tabela `usuarios` vazia. Se o banco já
tem gente, são ignoradas e você entra com a senha que já existe. Cadastre mesmo assim: são a
rede de segurança para o dia em que o banco for reconstruído do zero.

### Health check

`GET /saude` responde `200` com o banco de pé e `503` sem ele. Fica antes da sessão, então
o monitor não abre sessão a cada batida, e é a única rota que dispensa login.

### Duas instâncias ao mesmo tempo

Deploy no Render sobe a versão nova antes de derrubar a velha, então dois processos podem
inicializar juntos e tentar aplicar a mesma migração. O aplicador pega uma trava consultiva
**de transação** (`pg_advisory_xact_lock`) antes de ler a versão; o segundo processo espera,
relê e vê que não há nada pendente.

A trava é de transação e não de sessão por causa do pooler: a URL do Neon aponta para o
endpoint `-pooler`, que é PgBouncer em modo transação, e ali cada consulta pode cair num
backend diferente. `pg_advisory_lock` não segura nada nesse arranjo — testei, os dois
processos pegam a trava e seguem em frente. A de transação segura, porque a transação
inteira fica presa a um backend só.

### Sessões e reinício

As sessões ficam na tabela `sessoes`, no Postgres. Reinício, deploy ou troca de instância
não desloga ninguém. Cookie `httpOnly`, `sameSite=lax` e `secure` quando `NODE_ENV=production`,
com `trust proxy` ligado para o cookie e o limite de tentativas de login enxergarem a
requisição original por trás do proxy.

## Papéis

| | admin | usuario |
|---|---|---|
| Ver tudo | sim | sim |
| Alterar status e link | sim | sim |
| Criar, editar, mover, duplicar, excluir demanda | sim | não |
| Clientes, tags, importação, usuários | sim | não |

A permissão é verificada no servidor, rota a rota, pelo papel da sessão. Esconder botão no
front é acabamento: uma requisição fora da permissão responde 403 mesmo que a interface não
ofereça o caminho.

## Importação de calendário

Restrita ao admin. Arquivo JSON de `versao_schema: 1`, com `clientes` e `demandas`.
Sempre aditiva: nunca sobrescreve, nunca apaga.

Deduplicação: cliente por `id_externo` ou por nome ignorando maiúsculas, acentos e espaços;
demanda por `uid` ou pela combinação de cliente, data, tag e título. Tudo passa por uma prévia
antes de gravar, e a gravação inteira acontece numa transação.

Exemplo do formato em `dev-seed/exemplo-import.json`.

## PDF

Não existe geração de PDF pelo servidor. A tela do cliente monta uma folha de impressão e
chama a impressão do navegador; no destino, escolha "Salvar como PDF". A folha sai sem status
e sem link, em fundo branco, com quebra de página respeitando a semana.

## Estrutura

```
server/            Express, rotas, acesso a banco, autenticação, importação
  index.js         inicialização: migrações, admin inicial, sessão, estáticos
  db.js            pool do pg e helper de transação
  migracoes.js     aplicador de migrações
  autenticacao.js  sessão, bcrypt, middlewares de papel, rate limit do login
  repositorio.js   clientes, tags e demandas
  importacao.js    validação, deduplicação e gravação da importação
  rotas.js         a API
migrations/        SQL numerado
public/            front-end servido como estático
  js/api.js        ponte HTTP; mantém a forma do antigo window.api
dev-seed/          arquivo de exemplo da importação
render.yaml        descrição do serviço para a hospedagem
.node-version      versão do Node usada no deploy
```
