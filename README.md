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

## Papel e cargo

São duas coisas separadas. **Papel** é permissão. **Cargo** é a função no time.

| | admin | usuario |
|---|---|---|
| Ver tudo | sim | sim |
| Alterar status e link | sim | sim |
| Responsável, prioridade, prazo, data da solicitação, extra | sim | não |
| Criar, editar, mover, duplicar, excluir demanda | sim | não |
| Clientes, tags, importação, usuários | sim | não |
| Criar e editar rotina de qualquer pessoa | sim | não |
| Marcar o próprio check de rotina | sim | sim |

Cargos: `head`, `social_media`, `designer`, `editor_video`, `gestor_trafego`, `espectador`.
Os cinco primeiros não mudam permissão nenhuma — são só a função de cada um.

**`espectador` é a exceção**: é leitura pura, e vale mesmo quando o papel é `admin`. Não
altera nada, não aparece na lista de responsáveis e não pode receber demanda. Promover
alguém a espectador solta as demandas em que essa pessoa era responsável, porque espectador
não executa trabalho.

A permissão é verificada no servidor, rota a rota, pelo papel da sessão. Esconder botão no
front é acabamento: uma requisição fora da permissão responde 403 mesmo que a interface não
ofereça o caminho. A barreira do espectador fica num único middleware, por método HTTP e não
por rota, para que uma rota nova nasça protegida em vez de depender de eu lembrar dela.

## Prazo e atraso

`prazo` pode ficar vazio. Vazio, vale a `data` da peça no calendário — é `COALESCE(prazo,
data)` em toda consulta, e foi assim que as 357 demandas que já existiam passaram a ter
prazo válido sem ninguém preencher nada.

Três derivações, calculadas a cada consulta e **nunca gravadas em coluna**:

| | regra |
|---|---|
| Atrasada | pendente e prazo anterior a hoje |
| No prazo | concluída e `concluido_em` dentro do dia do prazo |
| Dias para entrega | prazo menos hoje, negativo quando atrasada |

Não são colunas porque "atrasada" muda sozinha na virada da meia-noite, sem ninguém tocar na
demanda: uma coluna ficaria errada dormindo. O "hoje" é calculado em `America/Sao_Paulo`
e não em UTC, senão das 21h à meia-noite o servidor já estaria no dia seguinte e demanda em
dia apareceria como atrasada.

`concluido_em` é preenchido quando o status vira Concluído e limpo quando volta para
Pendente. Editar uma demanda que já estava concluída não reescreve essa hora.

## Dashboard

Aba própria, aberta a todos. Mês a mês, e o seletor lista só os meses que têm demanda.

Tudo é contado no banco a cada pedido. Não existe tabela de resumo nem rotina de recálculo:
marcar Concluído já muda o resultado da próxima consulta, porque não há nada em cache para
ficar velho.

O índice de entrega no prazo tem denominador próprio — só as concluídas que têm
`concluido_em`. Concluída sem hora registrada não conta como atraso, conta como não medida, e
a tela diz quantas são. Um número que mente para baixo é pior que um número com ressalva.

## Rotinas

Trabalho recorrente do time, em tabelas separadas (`rotinas`, `rotina_checks`). **Rotina não
é demanda**: não existe caminho que crie uma a partir da outra, e nenhuma das duas tabelas
referencia a outra.

Diária aparece todo dia; semanal só nos dias configurados; mensal só no dia do mês, e dia 29,
30 ou 31 em mês mais curto cai no último dia — senão a tarefa nunca apareceria nesses meses.

No consolidado do time, o denominador dos 7 e 30 dias é o número de vezes que a rotina
realmente caiu no período, não rotina × dias: tarefa de segunda conta 1 vez em 7 dias, não 7.

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
  autenticacao.js  sessão, bcrypt, middlewares de papel e cargo, rate limit
  repositorio.js   clientes, tags, demandas e as derivações de prazo
  painel.js        as contas do dashboard, só leitura
  rotinas.js       rotinas, recorrência e checks
  importacao.js    validação, deduplicação e gravação da importação
  rotas.js         a API
migrations/        SQL numerado
public/            front-end servido como estático
  js/api.js        ponte HTTP; mantém a forma do antigo window.api
dev-seed/          arquivo de exemplo da importação
render.yaml        descrição do serviço para a hospedagem
.node-version      versão do Node usada no deploy
```
