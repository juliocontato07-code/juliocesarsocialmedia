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
  res.json({ id: achado.id, usuario: achado.usuario, papel: achado.papel });
}));

router.delete('/sessao', function (req, res) {
  req.session.destroy(function () {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/sessao', rota(async function (req, res) {
  const id = req.session && req.session.usuarioId;
  if (!id) return res.status(401).json({ erro: 'Sem sessão.' });

  const usuario = await bd.uma('SELECT id, usuario, papel, ativo FROM usuarios WHERE id = $1', [id]);
  if (!usuario || !usuario.ativo) return res.status(401).json({ erro: 'Sem sessão.' });

  res.json({ id: usuario.id, usuario: usuario.usuario, papel: usuario.papel });
}));

/* daqui para baixo, tudo exige login */
router.use(rota(auth.exigirLogin));

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
    'SELECT id, usuario, papel, ativo, criado_em FROM usuarios ORDER BY ativo DESC, usuario'
  ));
}));

router.post('/usuarios', auth.exigirAdmin, rota(async function (req, res) {
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const senha = String((req.body && req.body.senha) || '');
  const papel = String((req.body && req.body.papel) || 'usuario');

  if (usuario === '') return res.status(400).json({ erro: 'Informe o nome de usuário.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa de pelo menos 6 caracteres.' });
  if (['admin', 'usuario'].indexOf(papel) === -1) return res.status(400).json({ erro: 'Papel inválido.' });

  const existe = await bd.uma('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
  if (existe) return res.status(409).json({ erro: 'Já existe um usuário com esse nome.' });

  const criado = await bd.uma(
    'INSERT INTO usuarios (usuario, senha_hash, papel) VALUES ($1,$2,$3) RETURNING id, usuario, papel, ativo, criado_em',
    [usuario, await auth.gerarHash(senha), papel]
  );

  res.status(201).json(criado);
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

router.get('/importacoes', auth.exigirAdmin, rota(async function (req, res) {
  res.json(await bd.varias(
    `SELECT i.*, u.usuario FROM importacoes i JOIN usuarios u ON u.id = i.usuario_id
     ORDER BY i.criado_em DESC LIMIT 20`
  ));
}));

module.exports = router;
