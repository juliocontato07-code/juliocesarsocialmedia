-- Cofre de acessos: as credenciais das contas que a agência opera para cada
-- cliente, e o cargo que pode abri-lo.
-- Só CREATE e ALTER ADD: nada aqui apaga, renomeia ou recria. Nunca edite
-- este arquivo depois de aplicado.

/* ------------------------------------------------------------------ *
 * 1. Os acessos                                                       *
 * ------------------------------------------------------------------ */

/*
 * A senha fica cifrada, não com hash.
 *
 * A senha de login do sistema é bcrypt porque ninguém precisa lê-la de volta:
 * basta comparar. Esta é o oposto — o designer precisa entrar no Instagram do
 * cliente, então ela tem de voltar em texto. Por isso AES-256-GCM, com IV
 * próprio por registro e a tag de autenticação guardada junto: sem a tag, uma
 * alteração no texto cifrado passaria despercebida e devolveria lixo em vez de
 * erro.
 *
 * A chave de 32 bytes mora em CREDENTIALS_KEY, no ambiente. Ela não está aqui,
 * não está no repositório e não entra em nenhuma coluna: quem levar um dump
 * deste banco leva três colunas de ruído.
 */
CREATE TABLE cliente_acessos (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta TEXT NOT NULL,
  login TEXT NOT NULL,
  senha_cifrada TEXT NOT NULL,
  senha_iv TEXT NOT NULL,
  senha_tag TEXT NOT NULL,
  observacoes TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_cliente_acessos_cliente ON cliente_acessos (cliente_id, ordem, id);

/* ------------------------------------------------------------------ *
 * 2. Quem olhou                                                       *
 * ------------------------------------------------------------------ */

/*
 * Revelar e copiar são leitura, e leitura não deixa rastro em lugar nenhum.
 * Aqui deixa. Não é para desconfiar de ninguém: é para que, no dia em que uma
 * conta de cliente for acessada por quem não devia, exista onde olhar em vez
 * de uma conversa de "não fui eu".
 */
CREATE TABLE acesso_consultas (
  id SERIAL PRIMARY KEY,
  acesso_id INTEGER NOT NULL REFERENCES cliente_acessos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  acao TEXT NOT NULL,          -- 'revelou' ou 'copiou'
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_acesso_consultas_recentes ON acesso_consultas (acesso_id, criado_em DESC);

/* ------------------------------------------------------------------ *
 * 3. A permissão                                                      *
 * ------------------------------------------------------------------ */

/*
 * Quem abre o cofre é decidido pelo cargo, não pelo papel.
 *
 * Papel responde "pode administrar o sistema?". Cargo responde "o que esta
 * pessoa faz aqui?". Ver a senha do Instagram do cliente é a segunda pergunta:
 * um admin com cargo de Designer administra o app e não tem por que abrir
 * conta de cliente, e uma Head sem papel de admin tem.
 *
 * Padrão false, e só dois cargos nascem marcados. Cargo novo entra fechado.
 */
ALTER TABLE cargos ADD COLUMN acessa_credenciais BOOLEAN NOT NULL DEFAULT false;

UPDATE cargos SET acessa_credenciais = true WHERE nome IN ('Head', 'Gestor de tráfego');
