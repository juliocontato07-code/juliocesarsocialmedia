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
```
