-- Cargo no time, campos de atribuição e prazo na demanda, e as rotinas.
-- Só ALTER e CREATE: nada aqui apaga, renomeia ou recria.
-- Nunca edite este arquivo depois de aplicado.

/* ------------------------------------------------------------------ *
 * 1. Cargo: função no time, separada da permissão                     *
 * ------------------------------------------------------------------ */

-- papel (admin/usuario) continua sendo quem decide permissão. cargo é outra
-- coisa: o que a pessoa faz. Os dois são independentes de propósito, porque
-- um designer pode ser admin e um head pode não precisar ser.
--
-- O DEFAULT 'social_media' existe para os usuários que já estão cadastrados
-- receberem um valor válido sem adivinhação minha; o Júlio corrige um por um
-- na tela de usuários. Sem DEFAULT o NOT NULL não passaria.
ALTER TABLE usuarios ADD COLUMN cargo TEXT NOT NULL DEFAULT 'social_media'
  CHECK (cargo IN ('head','social_media','designer','editor_video','gestor_trafego','espectador'));

/* ------------------------------------------------------------------ *
 * 2. Campos novos da demanda                                          *
 * ------------------------------------------------------------------ */

-- quem executa. Nulo é estado legítimo: demanda ainda não distribuída.
ALTER TABLE demandas ADD COLUMN responsavel_id INTEGER REFERENCES usuarios(id);

ALTER TABLE demandas ADD COLUMN prioridade TEXT NOT NULL DEFAULT 'media'
  CHECK (prioridade IN ('baixa','media','alta'));

-- quando o cliente pediu. Nulo para tudo que já está no banco: não há como
-- saber essa data retroativamente, e inventar seria pior que deixar vazio.
ALTER TABLE demandas ADD COLUMN data_solicitacao DATE;

-- prazo de entrega. Fica nulo e o sistema usa `data` no lugar (COALESCE nas
-- consultas), então as 357 demandas que já existem passam a ter prazo válido
-- sem ninguém preencher nada.
ALTER TABLE demandas ADD COLUMN prazo DATE;

ALTER TABLE demandas ADD COLUMN concluido_em TIMESTAMPTZ;

-- solicitação fora do escopo contratado
ALTER TABLE demandas ADD COLUMN extra BOOLEAN NOT NULL DEFAULT false;

/* ------------------------------------------------------------------ *
 * 3. concluido_em das demandas que já estavam concluídas              *
 * ------------------------------------------------------------------ */

-- Sem isto, toda a história (173 demandas concluídas) entraria no dashboard
-- sem data de conclusão, e o indicador de entrega no prazo nasceria vazio.
--
-- atualizado_em é evidência real, não estimativa: conferi antes de escrever
-- esta linha que as 173 têm atualizado_em distintos entre si, espalhados por
-- três semanas. Quer dizer que cada uma foi marcada individualmente no app, e
-- atualizado_em é justamente o instante daquele clique. Fosse tudo o mesmo
-- carimbo de importação, esta linha não estaria aqui.
--
-- Toca só quem está concluída e sem concluido_em, então rodar de novo não
-- muda nada.
UPDATE demandas SET concluido_em = atualizado_em
 WHERE status = 1 AND concluido_em IS NULL;

/* ------------------------------------------------------------------ *
 * 4. Rotinas: trabalho recorrente do time                             *
 * ------------------------------------------------------------------ */

-- Rotina não é demanda e não aparece em tela de demanda. São coisas separadas,
-- sem nenhuma referência de uma para a outra.
CREATE TABLE rotinas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tarefa TEXT NOT NULL,
  horario TIME,
  frequencia TEXT NOT NULL CHECK (frequencia IN ('diaria','semanal','mensal')),
  dias_semana TEXT,        -- ex: 'SEG,QUA,SEX' quando semanal
  dia_mes INTEGER,         -- quando mensal
  ativa BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um check por rotina e por dia. O UNIQUE é o que deixa marcar e desmarcar
-- ser idempotente: o gravar vira INSERT ... ON CONFLICT.
CREATE TABLE rotina_checks (
  id SERIAL PRIMARY KEY,
  rotina_id INTEGER NOT NULL REFERENCES rotinas(id),
  data DATE NOT NULL,
  concluida BOOLEAN NOT NULL DEFAULT false,
  marcado_em TIMESTAMPTZ,
  UNIQUE (rotina_id, data)
);

/* ------------------------------------------------------------------ *
 * 5. Índices                                                          *
 * ------------------------------------------------------------------ */

-- o dashboard agrupa por responsável e a lista ordena por prazo
CREATE INDEX idx_demandas_responsavel ON demandas(responsavel_id);
CREATE INDEX idx_demandas_prazo ON demandas(COALESCE(prazo, data));
CREATE INDEX idx_demandas_extra ON demandas(extra) WHERE extra = true;

CREATE INDEX idx_rotinas_usuario ON rotinas(usuario_id) WHERE ativa = true;
CREATE INDEX idx_rotina_checks_data ON rotina_checks(data);
