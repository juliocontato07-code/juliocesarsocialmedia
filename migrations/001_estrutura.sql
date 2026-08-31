-- Estrutura inicial do app em Postgres.
-- Nunca edite este arquivo depois de aplicado: mudança de estrutura vira uma
-- migração nova, numerada, para o banco continuar reconstruível do repositório.

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin','usuario')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clientes (
  id SERIAL PRIMARY KEY,
  id_externo TEXT UNIQUE,
  nome TEXT NOT NULL,
  arroba TEXT NOT NULL DEFAULT '',
  nicho TEXT NOT NULL DEFAULT '',
  tipo_negocio TEXT NOT NULL DEFAULT '',
  contato TEXT NOT NULL DEFAULT '',
  observacoes TEXT NOT NULL DEFAULT '',
  arquivado BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  cor TEXT NOT NULL DEFAULT '#9A9A9A',
  ordem INTEGER NOT NULL DEFAULT 0,
  arquivada BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE demandas (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  data DATE NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0,1)),
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_demandas_data ON demandas(data);
CREATE INDEX idx_demandas_cliente_data ON demandas(cliente_id, data);
CREATE INDEX idx_demandas_dedupe ON demandas(cliente_id, data, tag_id);

-- Preferência é de cada pessoa: filtro que eu escondo não some para você.
CREATE TABLE preferencias (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  chave TEXT NOT NULL,
  valor TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (usuario_id, chave)
);

CREATE TABLE importacoes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  arquivo TEXT,
  clientes_criados INTEGER NOT NULL DEFAULT 0,
  demandas_criadas INTEGER NOT NULL DEFAULT 0,
  duplicadas_descartadas INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessões, no formato que o connect-pg-simple espera. Fica aqui, e não na
-- criação automática da biblioteca, para o schema inteiro vir do repositório.
CREATE TABLE sessoes (
  sid TEXT PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessoes_expire ON sessoes(expire);

-- As quatro tags de sempre. A importação cria as que faltarem.
INSERT INTO tags (nome, cor, ordem) VALUES
  ('Estático',  '#E11D2E', 0),
  ('Carrossel', '#F59E0B', 1),
  ('Vídeo',     '#3B82F6', 2),
  ('Story',     '#22C55E', 3);
