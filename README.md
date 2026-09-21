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
| Responsáveis, prioridade, data da solicitação, data de conclusão, extra | sim | não |
| Criar, editar, mover, duplicar, excluir demanda | sim | não |
| Clientes, tags, cargos, importação, usuários | sim | não |
| Criar e editar rotina de qualquer pessoa | sim | não |
| Marcar o próprio check de rotina | sim | sim |

Os cargos são um cadastro (tabela `cargos`), não uma lista fixa: veja **Cargos, pessoas e
atribuição** abaixo.

A permissão é verificada no servidor, rota a rota, pelo papel da sessão. Esconder botão no
front é acabamento: uma requisição fora da permissão responde 403 mesmo que a interface não
ofereça o caminho.

## Prazo e atraso

**O prazo é a data da publicação.** Não existe campo de prazo separado. A coluna `prazo`
continua no banco porque migração é aditiva, mas nada no sistema a lê — de propósito, para
não haver duas respostas possíveis para "qual é o prazo desta demanda".

Uma demanda está em dia enquanto estiver dentro das 24 horas do dia da publicação:

| | em dia quando |
|---|---|
| Concluída | a data da conclusão é menor ou igual à data da publicação |
| Pendente | hoje é menor ou igual à data da publicação |

Tudo isso sai de **uma expressão só**, `EM_DIA` em [server/repositorio.js](server/repositorio.js),
importada pela Lista, pelo Dashboard e pelos cards. Nenhuma tela tem a sua própria versão:
duas versões divergem no primeiro caso de borda e ninguém descobre qual está certa.

A comparação é entre **datas civis em `America/Sao_Paulo`**, nunca entre timestamp e
meia-noite. A hospedagem roda em UTC, e "dentro do dia" é uma pergunta sobre o calendário de
quem trabalha, não sobre o relógio do servidor.

Nada disso é coluna: "em atraso" muda sozinha na virada da meia-noite, sem ninguém tocar na
demanda, e uma coluna ficaria errada dormindo.

`concluido_em` é gravado quando a bolinha fica verde e limpo quando volta para vermelha.
Editar uma demanda já concluída não reescreve essa hora. **O admin pode corrigir a data** na
tela da demanda, para o caso de alguém entregar no dia e marcar depois — é o campo que
conserta o indicador de quem executou. Concluída sem data registrada aparece como "Em dia",
com a ressalva no `title`: afirmar atraso sem evidência seria acusar de graça.

## Cargos, pessoas e atribuição

Três cadastros, todos na tela de **Usuários**, porque é junto que a cadeia se lê inteira:

```
tag  ->  cargo  ->  profissionais ativos daquele cargo
```

Quando uma demanda é criada — por importação ou à mão — o sistema olha a tag, acha o cargo e
atribui **todos** os usuários ativos daquele cargo. Dois designers no mesmo cargo recebem os
dois. Tag sem cargo, ou cargo sem ninguém ativo, gera demanda sem responsável, que é estado
legítimo.

A atribuição é **resolvida na criação e gravada** em `demanda_responsaveis`. Não é consulta
viva: se alguém trocar de cargo ou entrar no time amanhã, as demandas antigas continuam com
quem as recebeu. Histórico que se reescreve sozinho não mede o trabalho de ninguém.

No formulário manual os responsáveis vêm pré-preenchidos pela regra, e o admin pode mudar —
a sugestão para de agir no instante em que alguém marca à mão.

`cargos.somente_leitura` substituiu a regra especial do antigo cargo Espectador: **qualquer**
cargo marcado assim vê tudo, não altera nada e nunca é atribuído, mesmo com permissão de
administrador. A barreira é um middleware único, por método HTTP, então cargo novo marcado
assim já nasce restrito sem tocar em código.

Cargo e tag não se excluem: desativa-se e arquiva-se.

No Dashboard, **cada responsável recebe a demanda inteira** nas suas métricas, e o total do
time conta a demanda uma vez só. A soma da coluna pode passar do total do mês, e a tela diz
isso numa nota — senão alguém soma, vê 380 num mês de 336 e conclui que está errado.

O botão **Atribuir demandas sem responsável**, na tela de Usuários, aplica a regra ao que já
está no banco. Ele mostra quantas são antes de agir e **não toca em demanda que já tenha
responsável**.

## Nome completo e iniciais

`usuarios.nome_completo` é só para exibição; o login continua sendo `usuario`. As iniciais são
a primeira letra do primeiro nome e a primeira do último sobrenome — Júlio César vira JC. Um
nome só vira uma letra. Sem nome cadastrado, duas letras do login.

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
  repositorio.js   clientes, tags, demandas e a regra única de prazo (EM_DIA)
  atribuicao.js    cargos e a cadeia tag -> cargo -> responsáveis
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
