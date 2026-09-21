'use strict';

/**
 * Rotas da API.
 *
 * A permissão é verificada aqui, rota a rota, pelo papel da sessão.
 * Para o papel "usuario" só existem dois caminhos de escrita: alternar o
 * status e editar o link. Todo o resto responde 403, mesmo que a interface
 * não ofereça o botão.
 */

const express = require('express');

const bd = require('./db');
const auth = require('./autenticacao');
const { clientes, tags, demandas } = require('./repositorio');
const importacao = require('./importacao');
const painel = require('./painel');
const { rotinas, doDia, marcar, consolidado } = require('./rotinas');
const { cargos, pessoasDaTag, previaDoMutirao, mutirao } = require('./atribuicao');

const router = express.Router();

/** Embrulha handler async para o erro cair no middleware de erro. */
function rota(funcao) {
  return function (req, res, proximo) {
    Promise.resolve(funcao(req, res, proximo)).catch(proximo);
  };
}

/* ------------------------------------------------------------------ *
 * Sessão                                                              *
 * ------------------------------------------------------------------ */

router.post('/sessao', auth.limitarLogin, rota(async function (req, res) {
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const senha = String((req.body && req.body.senha) || '');

  if (usuario === '' || senha === '') {
    return res.status(400).json({ erro: 'Informe usuário e senha.' });
  }

  const achado = await bd.uma(
    'SELECT id, usuario, senha_hash, papel, ativo FROM usuarios WHERE usuario = $1', [usuario]
  );

  /* mensagem única de propósito: não dizer se o usuário existe */
  const generico = { erro: 'Usuário ou senha incorretos.' };

  if (!achado) return res.status(401).json(generico);
  if (!achado.ativo) return res.status(403).json({ erro: 'Este acesso foi desativado.' });

  const confere = await auth.conferirSenha(senha, achado.senha_hash);
  if (!confere) return res.status(401).json(generico);

  req.session.usuarioId = achado.id;
  res.json(await perfil(achado.id));
}));

/** O que o front precisa saber sobre quem está logado. */
async function perfil(id) {
  return bd.uma(
    `SELECT u.id, u.usuario, u.nome_completo, u.papel, u.cargo_id,
            c.nome AS cargo_nome, COALESCE(c.somente_leitura, false) AS somente_leitura
       FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id
      WHERE u.id = $1`, [id]
  );
}

router.delete('/sessao', function (req, res) {
  req.session.destroy(function () {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/sessao', rota(async function (req, res) {
  const id = req.session && req.session.usuarioId;
  if (!id) return res.status(401).json({ erro: 'Sem sessão.' });

  const ativo = await bd.uma('SELECT ativo FROM usuarios WHERE id = $1', [id]);
  if (!ativo || !ativo.ativo) return res.status(401).json({ erro: 'Sem sessão.' });

  res.json(await perfil(id));
}));

/* daqui para baixo, tudo exige login */
router.use(rota(auth.exigirLogin));

/*
 * Cargo marcado como somente leitura não altera nada, e isso vale mesmo
 * quando o papel é admin.
 *
 * Fica aqui, uma vez, valendo para todo método que não é GET, em vez de rota
 * por rota: a regra é "não altera nada", e listar rota por rota deixaria a
 * próxima rota nova desprotegida por esquecimento.
 */
router.use(auth.barrarSomenteLeitura);

/* ------------------------------------------------------------------ *
 * Trocar a própria senha                                              *
 * ------------------------------------------------------------------ */

router.post('/minha-senha', rota(async function (req, res) {
  const atual = String((req.body && req.body.atual) || '');
  const nova = String((req.body && req.body.nova) || '');

  if (nova.length < 6) {
    return res.status(400).json({ erro: 'A senha nova precisa de pelo menos 6 caracteres.' });
  }

  const linha = await bd.uma('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
  const confere = await auth.conferirSenha(atual, linha.senha_hash);
  if (!confere) return res.status(403).json({ erro: 'A senha atual está incorreta.' });

  await bd.consultar('UPDATE usuarios SET senha_hash = $2 WHERE id = $1',
    [req.usuario.id, await auth.gerarHash(nova)]);

  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ *
 * Usuários (admin)                                                    *
 * ------------------------------------------------------------------ */

router.get('/usuarios', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await bd.varias(
    `SELECT u.id, u.usuario, u.nome_completo, u.papel, u.ativo, u.criado_em,
            u.cargo_id, c.nome AS cargo_nome,
            COALESCE(c.somente_leitura, false) AS cargo_somente_leitura
       FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id
      ORDER BY u.ativo DESC, COALESCE(NULLIF(u.nome_completo,''), u.usuario)`
  ));
}));

/**
 * Quem pode ser responsável por demanda.
 *
 * Liberado para todos, e não só para admin, porque a tela de lista precisa
 * desta lista para montar o filtro de responsável. É só nome e cargo: não
 * vaza papel nem situação de acesso.
 *
 * Cargo somente leitura fica fora: quem não altera nada também não executa.
 */
router.get('/usuarios/atribuiveis', rota(async function (req, res) {
  res.json(await bd.varias(
    `SELECT u.id, u.usuario, u.nome_completo, u.cargo_id, c.nome AS cargo
       FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id
      WHERE u.ativo = true AND COALESCE(c.somente_leitura, false) = false
      ORDER BY COALESCE(NULLIF(u.nome_completo,''), u.usuario)`
  ));
}));

router.post('/usuarios', auth.exigirAdmin, rota(async function (req, res) {
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const senha = String((req.body && req.body.senha) || '');
  const papel = String((req.body && req.body.papel) || 'usuario');
  const nomeCompleto = String((req.body && req.body.nome_completo) || '').trim();
  const cargoId = req.body && req.body.cargo_id;

  if (usuario === '') return res.status(400).json({ erro: 'Informe o nome de usuário.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa de pelo menos 6 caracteres.' });
  if (['admin', 'usuario'].indexOf(papel) === -1) return res.status(400).json({ erro: 'Papel inválido.' });

  const cargo = await cargoExistente(cargoId);
  if (!cargo) return res.status(400).json({ erro: 'Escolha um cargo ativo.' });

  const existe = await bd.uma('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
  if (existe) return res.status(409).json({ erro: 'Já existe um usuário com esse nome.' });

  const criado = await bd.uma(
    `INSERT INTO usuarios (usuario, senha_hash, papel, cargo_id, nome_completo)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [usuario, await auth.gerarHash(senha), papel, cargo.id, nomeCompleto]
  );

  res.status(201).json(await perfil(criado.id));
}));

/** Cargo ativo ou nada: usuário sem cargo não entra na cadeia de atribuição. */
async function cargoExistente(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  return bd.uma('SELECT id, nome, somente_leitura FROM cargos WHERE id = $1 AND ativo = true', [numero]);
}

/** Nome, papel e cargo de quem já existe. Não mexe em senha nem em situação. */
router.put('/usuarios/:id', auth.exigirAdmin, rota(async function (req, res) {
  const id = Number(req.params.id);
  const papel = String((req.body && req.body.papel) || '');
  const nomeCompleto = String((req.body && req.body.nome_completo) || '').trim();
  const cargoId = req.body && req.body.cargo_id;

  if (['admin', 'usuario'].indexOf(papel) === -1) return res.status(400).json({ erro: 'Papel inválido.' });

  const cargo = await cargoExistente(cargoId);
  if (!cargo) return res.status(400).json({ erro: 'Escolha um cargo ativo.' });

  /* Tirar o próprio papel de admin trancaria o Júlio fora da área de
     administração na próxima requisição, sem ninguém para devolver. */
  if (id === req.usuario.id && papel !== 'admin') {
    return res.status(400).json({ erro: 'Você não pode tirar o seu próprio acesso de administrador.' });
  }

  if (papel !== 'admin') {
    const outros = await bd.uma(
      "SELECT COUNT(*)::int AS n FROM usuarios WHERE papel = 'admin' AND ativo = true AND id <> $1", [id]
    );
    if (outros.n === 0) {
      return res.status(400).json({ erro: 'É preciso manter ao menos um administrador ativo.' });
    }
  }

  const r = await bd.consultar(
    'UPDATE usuarios SET papel = $2, cargo_id = $3, nome_completo = $4 WHERE id = $1',
    [id, papel, cargo.id, nomeCompleto]
  );
  if (r.rowCount === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const atualizado = await perfil(id);

  /* Cargo somente leitura é leitura pura: quem já era responsável deixa de
     poder ser, então a atribuição sai. */
  if (cargo.somente_leitura) {
    const soltas = await bd.consultar(
      'DELETE FROM demanda_responsaveis WHERE usuario_id = $1', [id]
    );
    atualizado.demandas_liberadas = soltas.rowCount;
  }

  res.json(atualizado);
}));

/* ------------------------------------------------------------------ *
 * Cargos (admin para escrever, todos para ler)                        *
 * ------------------------------------------------------------------ */

router.get('/cargos', rota(async function (req, res) {
  res.json(await cargos.listar({ incluirInativos: req.query.incluirInativos === '1' }));
}));

router.post('/cargos', auth.exigirAdmin, rota(async function (req, res) {
  res.status(201).json(await cargos.criar(req.body || {}));
}));

router.put('/cargos/:id', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await cargos.atualizar(req.params.id, req.body || {}));
}));

router.post('/cargos/reordenar', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await cargos.reordenar((req.body && req.body.ids) || []));
}));

router.post('/cargos/:id/ativo', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await cargos.definirAtivo(req.params.id, Boolean(req.body && req.body.ativo)));
}));

/* ------------------------------------------------------------------ *
 * Atribuição automática                                              *
 * ------------------------------------------------------------------ */

/** Quem a regra da tag atribuiria agora. A tela de tags mostra isto. */
router.get('/tags/:id/pessoas', rota(async function (req, res) {
  res.json(await pessoasDaTag(Number(req.params.id)));
}));

/** Quantas demandas estão sem ninguém, para a confirmação do mutirão. */
router.get('/atribuicao/previa', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await previaDoMutirao());
}));

router.post('/atribuicao/mutirao', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await mutirao());
}));

router.post('/usuarios/:id/senha', auth.exigirAdmin, rota(async function (req, res) {
  const nova = String((req.body && req.body.senha) || '');
  if (nova.length < 6) return res.status(400).json({ erro: 'A senha precisa de pelo menos 6 caracteres.' });

  const r = await bd.consultar('UPDATE usuarios SET senha_hash = $2 WHERE id = $1',
    [req.params.id, await auth.gerarHash(nova)]);

  if (r.rowCount === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json({ ok: true });
}));

router.post('/usuarios/:id/ativo', auth.exigirAdmin, rota(async function (req, res) {
  const ativo = Boolean(req.body && req.body.ativo);
  const id = Number(req.params.id);

  if (!ativo && id === req.usuario.id) {
    return res.status(400).json({ erro: 'Você não pode desativar o próprio acesso.' });
  }

  if (!ativo) {
    const admins = await bd.uma(
      "SELECT COUNT(*)::int AS n FROM usuarios WHERE papel = 'admin' AND ativo = true AND id <> $1", [id]
    );
    if (admins.n === 0) {
      return res.status(400).json({ erro: 'É preciso manter ao menos um administrador ativo.' });
    }
  }

  const r = await bd.consultar('UPDATE usuarios SET ativo = $2 WHERE id = $1 RETURNING id', [id, ativo]);
  if (r.rowCount === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ *
 * Clientes                                                            *
 * ------------------------------------------------------------------ */

router.get('/clientes', rota(async function (req, res) {
  res.json(await clientes.listar({
    incluirArquivados: req.query.incluirArquivados === '1',
    somenteArquivados: req.query.somenteArquivados === '1'
  }));
}));

router.get('/clientes/:id/resumo', rota(async function (req, res) {
  res.json(await clientes.resumo(req.params.id));
}));

router.post('/clientes', auth.exigirAdmin, rota(async function (req, res) {
  res.status(201).json(await clientes.criar(req.body || {}));
}));

router.put('/clientes/:id', auth.exigirAdmin, rota(async function (req, res) {
  const atualizado = await clientes.atualizar(req.params.id, req.body || {});
  if (!atualizado) return res.status(404).json({ erro: 'Cliente não encontrado.' });
  res.json(atualizado);
}));

router.post('/clientes/:id/arquivar', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await clientes.arquivar(req.params.id));
}));

router.post('/clientes/:id/desarquivar', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await clientes.desarquivar(req.params.id));
}));

/* ------------------------------------------------------------------ *
 * Tags                                                                *
 * ------------------------------------------------------------------ */

router.get('/tags', rota(async function (req, res) {
  res.json(await tags.listar({ incluirArquivadas: req.query.incluirArquivadas === '1' }));
}));

router.post('/tags', auth.exigirAdmin, rota(async function (req, res) {
  res.status(201).json(await tags.criar(req.body || {}));
}));

router.put('/tags/:id', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await tags.atualizar(req.params.id, req.body || {}));
}));

router.post('/tags/:id/arquivar', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await tags.arquivar(req.params.id));
}));

router.post('/tags/:id/desarquivar', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await tags.desarquivar(req.params.id));
}));

router.post('/tags/reordenar', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await tags.reordenar((req.body && req.body.ids) || []));
}));

router.get('/tags/:id/uso', rota(async function (req, res) {
  res.json({ total: await tags.emUso(req.params.id) });
}));

/* ------------------------------------------------------------------ *
 * Demandas                                                            *
 * ------------------------------------------------------------------ */

router.get('/demandas', rota(async function (req, res) {
  const lista = await demandas.listarPeriodo(req.query.inicio, req.query.fim, {
    incluirArquivados: req.query.incluirArquivados === '1',
    clienteId: req.query.clienteId ? Number(req.query.clienteId) : null
  });
  res.json(lista);
}));

/** Listagem filtrada da tela de lista. Leitura, liberada para todos. */
router.get('/demandas/lista', rota(async function (req, res) {
  res.json(await demandas.listar({
    inicio: req.query.inicio || null,
    fim: req.query.fim || null,
    clienteId: req.query.clienteId || null,
    tagId: req.query.tagId || null,
    responsavelId: req.query.responsavelId || null,
    prioridade: req.query.prioridade || null,
    status: req.query.status === undefined || req.query.status === '' ? null : req.query.status,
    extra: req.query.extra === '1',
    somenteAtrasadas: req.query.atrasadas === '1',
    incluirArquivados: req.query.incluirArquivados === '1'
  }));
}));

router.get('/demandas/:id', rota(async function (req, res) {
  const demanda = await demandas.obter(req.params.id);
  if (!demanda) return res.status(404).json({ erro: 'Demanda não encontrada.' });
  res.json(demanda);
}));

router.post('/demandas', auth.exigirAdmin, rota(async function (req, res) {
  res.status(201).json(await demandas.criar(req.body || {}, req.usuario.id));
}));

/**
 * A rota de atualização é a única compartilhada entre os dois papéis, e é
 * onde a regra fica mais delicada: para "usuario" só passam status e link.
 */
router.put('/demandas/:id', rota(async function (req, res) {
  const corpo = req.body || {};

  if (!auth.ehAdmin(req)) {
    /* A lista não cresceu com os campos novos de propósito: responsável,
       prioridade, data da solicitação, extra e data de conclusão são decisão
       de quem coordena, não de quem executa. */
    const permitidos = ['status', 'link'];
    const proibidos = Object.keys(corpo).filter(function (c) { return permitidos.indexOf(c) === -1; });

    if (proibidos.length > 0) {
      return res.status(403).json({
        erro: 'Seu perfil só pode alterar o status e o link. Campos recusados: ' + proibidos.join(', ') + '.'
      });
    }

    return res.json(await demandas.atualizarLimitado(req.params.id, corpo, req.usuario.id));
  }

  res.json(await demandas.atualizar(req.params.id, corpo, req.usuario.id));
}));

/* alternar status: liberado para os dois papéis */
router.post('/demandas/:id/status', rota(async function (req, res) {
  res.json(await demandas.alternarStatus(req.params.id, req.usuario.id));
}));

/* editar link: liberado para os dois papéis */
router.post('/demandas/:id/link', rota(async function (req, res) {
  res.json(await demandas.atualizarLimitado(
    req.params.id, { link: (req.body && req.body.link) || '' }, req.usuario.id
  ));
}));

router.post('/demandas/:id/duplicar', auth.exigirAdmin, rota(async function (req, res) {
  res.status(201).json(await demandas.duplicar(
    req.params.id, (req.body && req.body.data) || null, req.usuario.id
  ));
}));

router.post('/demandas/:id/mover', auth.exigirAdmin, rota(async function (req, res) {
  const corpo = req.body || {};
  res.json(await demandas.mover(
    req.params.id, corpo.clienteId, corpo.data, corpo.posicao, req.usuario.id
  ));
}));

router.delete('/demandas/:id', auth.exigirAdmin, rota(async function (req, res) {
  const foi = await demandas.excluir(req.params.id);
  if (!foi) return res.status(404).json({ erro: 'Demanda não encontrada.' });
  res.json({ ok: true });
}));

router.post('/demandas/lote', auth.exigirAdmin, rota(async function (req, res) {
  const lista = (req.body && req.body.demandas) || [];
  const criadas = await bd.transacao(async function (conexao) {
    const feitas = [];
    for (const item of lista) feitas.push(await demandas.criar(item, req.usuario.id, conexao));
    return feitas;
  });
  res.status(201).json(criadas);
}));

/* ------------------------------------------------------------------ *
 * Preferências (por usuário)                                          *
 * ------------------------------------------------------------------ */

router.get('/preferencias', rota(async function (req, res) {
  const linhas = await bd.varias(
    'SELECT chave, valor FROM preferencias WHERE usuario_id = $1', [req.usuario.id]
  );
  const mapa = {};
  for (const linha of linhas) mapa[linha.chave] = linha.valor;
  res.json(mapa);
}));

router.put('/preferencias/:chave', rota(async function (req, res) {
  await bd.consultar(
    `INSERT INTO preferencias (usuario_id, chave, valor) VALUES ($1,$2,$3)
     ON CONFLICT (usuario_id, chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [req.usuario.id, req.params.chave, String((req.body && req.body.valor) || '')]
  );
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ *
 * Importação (admin)                                                  *
 * ------------------------------------------------------------------ */

router.post('/importar/previa', auth.exigirAdmin, rota(async function (req, res) {
  const conteudo = (req.body && req.body.conteudo) || '';
  const arquivo = (req.body && req.body.arquivo) || null;
  res.json(await importacao.previa(conteudo, arquivo));
}));

router.post('/importar/aplicar', auth.exigirAdmin, rota(async function (req, res) {
  const conteudo = (req.body && req.body.conteudo) || '';
  const arquivo = (req.body && req.body.arquivo) || null;
  res.json(await importacao.aplicar(conteudo, req.usuario.id, arquivo));
}));

/* ------------------------------------------------------------------ *
 * Dashboard (todos)                                                   *
 * ------------------------------------------------------------------ */

/* Meses que têm demanda, para o seletor não oferecer mês vazio. */
router.get('/painel/meses', rota(async function (req, res) {
  res.json(await painel.meses());
}));

router.get('/painel', rota(async function (req, res) {
  const inicio = String(req.query.inicio || '');
  const fim = String(req.query.fim || '');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return res.status(400).json({ erro: 'Informe inicio e fim no formato AAAA-MM-DD.' });
  }

  res.json(await painel.tudo(inicio, fim));
}));

/* ------------------------------------------------------------------ *
 * Rotinas                                                            *
 * ------------------------------------------------------------------ */

/**
 * Cadastro: admin vê e mexe em tudo, usuário vê só a própria rotina.
 *
 * Note que o filtro não vem do front: quem não é admin recebe o próprio id
 * à força, então mandar ?usuarioId=outro não muda nada.
 */
router.get('/rotinas', rota(async function (req, res) {
  const soAsMinhas = !auth.ehAdmin(req);

  res.json(await rotinas.listar({
    usuarioId: soAsMinhas ? req.usuario.id : (req.query.usuarioId || null),
    incluirInativas: !soAsMinhas && req.query.incluirInativas === '1'
  }));
}));

/** A rotina do dia, com o check daquela data. */
router.get('/rotinas/dia', rota(async function (req, res) {
  const data = String(req.query.data || '');
  const soAsMinhas = !auth.ehAdmin(req);

  res.json(await doDia(data, {
    usuarioId: soAsMinhas ? req.usuario.id : (req.query.usuarioId || null)
  }));
}));

/** Consolidado do time: hoje, 7 e 30 dias. Só admin. */
router.get('/rotinas/consolidado', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await consolidado(String(req.query.data || '')));
}));

router.post('/rotinas', auth.exigirAdmin, rota(async function (req, res) {
  res.status(201).json(await rotinas.criar(req.body || {}));
}));

router.put('/rotinas/:id', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await rotinas.atualizar(req.params.id, req.body || {}));
}));

router.post('/rotinas/:id/ativa', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await rotinas.definirAtiva(req.params.id, Boolean(req.body && req.body.ativa)));
}));

/**
 * Marcar o check.
 *
 * Esta é a única escrita de rotina liberada para o papel "usuario", e só na
 * própria rotina: marcar a tarefa de outra pessoa como feita é justamente o
 * que não pode acontecer. Espectador nem chega aqui, barrado antes.
 */
router.post('/rotinas/:id/check', rota(async function (req, res) {
  const rotina = await rotinas.obter(req.params.id);
  if (!rotina) return res.status(404).json({ erro: 'Rotina não encontrada.' });

  if (!auth.ehAdmin(req) && rotina.usuario_id !== req.usuario.id) {
    return res.status(403).json({ erro: 'Você só pode marcar a sua própria rotina.' });
  }

  const corpo = req.body || {};
  res.json(await marcar(req.params.id, corpo.data, corpo.concluida));
}));

/* ------------------------------------------------------------------ *
 * Importação (admin)                                                  *
 * ------------------------------------------------------------------ */

router.get('/importacoes', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await bd.varias(
    `SELECT i.*, u.usuario FROM importacoes i JOIN usuarios u ON u.id = i.usuario_id
     ORDER BY i.criado_em DESC LIMIT 20`
  ));
}));

module.exports = router;
