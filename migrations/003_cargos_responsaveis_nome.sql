-- Cargos como cadastro, nome completo, vários responsáveis por demanda e o
-- cargo responsável da tag.
-- Só CREATE, ALTER ADD e UPDATE de preenchimento: nada aqui apaga, renomeia
-- ou recria. Nunca edite este arquivo depois de aplicado.

/* ------------------------------------------------------------------ *
 * 1. Cargos viram tabela                                             *
 * ------------------------------------------------------------------ */

CREATE TABLE cargos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  somente_leitura BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true
);

-- Os seis que existiam como lista fixa no código. Daqui para frente o Júlio
-- cria os que quiser pela tela de usuários.
INSERT INTO cargos (nome, somente_leitura, ordem) VALUES
  ('Head',              false, 0),
  ('Social media',      false, 1),
  ('Designer',          false, 2),
  ('Editor de vídeo',   false, 3),
  ('Gestor de tráfego', false, 4),
  ('Espectador',        true,  5);

ALTER TABLE usuarios ADD COLUMN cargo_id INTEGER REFERENCES cargos(id);

-- Preenche a partir da coluna de texto que já existe. A coluna `cargo` fica
-- onde está, sem uso: apagar coluna é irreversível, e se algo der errado na
-- leitura nova ela é a única prova do que estava lá.
UPDATE usuarios u SET cargo_id = c.id
  FROM cargos c
 WHERE c.nome = CASE u.cargo
                  WHEN 'head'            THEN 'Head'
                  WHEN 'social_media'    THEN 'Social media'
                  WHEN 'designer'        THEN 'Designer'
                  WHEN 'editor_video'    THEN 'Editor de vídeo'
                  WHEN 'gestor_trafego'  THEN 'Gestor de tráfego'
                  WHEN 'espectador'      THEN 'Espectador'
                  ELSE 'Social media'
                END;

/* ------------------------------------------------------------------ *
 * 2. Nome completo                                                   *
 * ------------------------------------------------------------------ */

-- O login continua sendo `usuario`. Isto é só para exibição e para as
-- iniciais. Nasce vazio, e vazio significa "usa o login".
ALTER TABLE usuarios ADD COLUMN nome_completo TEXT NOT NULL DEFAULT '';

/* ------------------------------------------------------------------ *
 * 3. Vários responsáveis por demanda                                 *
 * ------------------------------------------------------------------ */

-- ON DELETE CASCADE só no lado da demanda: apagar demanda leva as
-- atribuições dela, mas usuário não se apaga neste sistema (desativa-se), e
-- um CASCADE ali esconderia o histórico de quem fez o quê.
CREATE TABLE demanda_responsaveis (
  demanda_id INTEGER NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  PRIMARY KEY (demanda_id, usuario_id)
);

-- Copia o que existe hoje. A coluna demandas.responsavel_id fica, sem uso.
INSERT INTO demanda_responsaveis (demanda_id, usuario_id)
SELECT id, responsavel_id FROM demandas WHERE responsavel_id IS NOT NULL
ON CONFLICT DO NOTHING;

/* ------------------------------------------------------------------ *
 * 4. Tag aponta para o cargo responsável                             *
 * ------------------------------------------------------------------ */

ALTER TABLE tags ADD COLUMN cargo_id INTEGER REFERENCES cargos(id);

-- Configuração inicial, só nas tags que ainda não têm cargo e cujo nome é
-- exatamente um destes. Tudo editável depois, na tela de usuários.
UPDATE tags SET cargo_id = (SELECT id FROM cargos WHERE nome = 'Designer')
 WHERE cargo_id IS NULL
   AND nome IN ('Estático', 'Estático Tráfego', 'Carrossel', 'Story');

UPDATE tags SET cargo_id = (SELECT id FROM cargos WHERE nome = 'Editor de vídeo')
 WHERE cargo_id IS NULL
   AND nome IN ('Vídeo', 'Vídeo Tráfego');

/* ------------------------------------------------------------------ *
 * 5. Índices                                                         *
 * ------------------------------------------------------------------ */

-- o dashboard agrupa por responsável, e a busca por "quem é responsável por
-- esta demanda" vem da chave primária
CREATE INDEX idx_dr_usuario ON demanda_responsaveis(usuario_id);

CREATE INDEX idx_usuarios_cargo ON usuarios(cargo_id) WHERE ativo = true;

-- a atribuição automática lê data e status na virada; o índice de prazo da
-- migração 002 era sobre COALESCE(prazo, data) e o sistema agora usa só data
CREATE INDEX idx_demandas_data_status ON demandas(data, status);
