'use strict';

/**
 * Sessão, senha e permissão.
 *
 * A permissão é decidida aqui, no servidor, a cada requisição. O front esconde
 * botão por acabamento; quem barra é este arquivo.
 */

const bcrypt = require('bcryptjs');

const bd = require('./db');

const CUSTO_BCRYPT = 12;

/* ------------------------------------------------------------------ *
 * Senhas                                                              *
 * ------------------------------------------------------------------ */

function gerarHash(senha) {
  return bcrypt.hash(String(senha), CUSTO_BCRYPT);
}

function conferirSenha(senha, hash) {
  return bcrypt.compare(String(senha), String(hash));
}

/* ------------------------------------------------------------------ *
 * Primeiro administrador                                              *
 * ------------------------------------------------------------------ */

/**
 * Cria o admin inicial só se a tabela estiver vazia. Havendo qualquer
 * usuário, as variáveis de ambiente são ignoradas de propósito: senão
 * bastaria mexer no painel para recriar um acesso.
 */
async function garantirAdminInicial() {
  const total = await bd.uma('SELECT COUNT(*)::int AS n FROM usuarios');
  if (total.n > 0) return { criado: false, motivo: 'já existe usuário cadastrado' };

  const usuario = (process.env.ADMIN_USUARIO || '').trim();
  const senha = process.env.ADMIN_SENHA || '';

  if (usuario === '' || senha === '') {
    return { criado: false, motivo: 'ADMIN_USUARIO e ADMIN_SENHA não definidos' };
  }

  const hash = await gerarHash(senha);
  await bd.consultar(
    "INSERT INTO usuarios (usuario, senha_hash, papel) VALUES ($1, $2, 'admin')",
    [usuario, hash]
  );

  console.log('[auth] administrador inicial criado: ' + usuario);
  return { criado: true, usuario: usuario };
}

/* ------------------------------------------------------------------ *
 * Middleware                                                          *
 * ------------------------------------------------------------------ */

/** Carrega o usuário da sessão e recusa quem não estiver logado. */
async function exigirLogin(req, res, proximo) {
  const id = req.session && req.session.usuarioId;
  if (!id) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });

  const usuario = await bd.uma(
    `SELECT u.id, u.usuario, u.nome_completo, u.papel, u.ativo,
            u.cargo_id, c.nome AS cargo_nome,
            COALESCE(c.somente_leitura, false) AS somente_leitura
       FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id
      WHERE u.id = $1`, [id]
  );

  if (!usuario || !usuario.ativo) {
    req.session.destroy(function () {});
    return res.status(401).json({ erro: 'Acesso revogado. Fale com o administrador.' });
  }

  req.usuario = usuario;
  proximo();
}

function exigirAdmin(req, res, proximo) {
  if (!req.usuario || req.usuario.papel !== 'admin') {
    return res.status(403).json({ erro: 'Esta ação é restrita ao administrador.' });
  }
  proximo();
}

function ehAdmin(req) {
  return Boolean(req.usuario && req.usuario.papel === 'admin');
}

/*
 * Somente leitura deixou de ser um cargo com nome especial e passou a ser uma
 * marca no cadastro de cargos. Quem marcar um cargo novo assim ganha a mesma
 * restrição, sem eu precisar tocar em código.
 */
function ehSomenteLeitura(req) {
  return Boolean(req.usuario && req.usuario.somente_leitura);
}

/* Rotas de escrita que o espectador ainda pode usar, porque não alteram dado
   do trabalho: só a própria senha. */
const ESCRITA_LIBERADA = ['/minha-senha'];

/**
 * Cargo somente leitura é leitura pura, e isso vale mesmo que o papel seja
 * admin.
 *
 * A checagem está num único lugar, por método e não por rota, porque a regra é
 * "não altera nada": listar rota por rota deixaria a próxima rota nova
 * desprotegida por esquecimento. GET passa, o resto não.
 */
function barrarSomenteLeitura(req, res, proximo) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return proximo();
  if (!ehSomenteLeitura(req)) return proximo();
  if (ESCRITA_LIBERADA.indexOf(req.path) > -1) return proximo();

  return res.status(403).json({
    erro: 'Seu cargo (' + (req.usuario.cargo_nome || 'somente leitura') +
          ') tem acesso somente leitura.'
  });
}

/* ------------------------------------------------------------------ *
 * Limite de tentativas de login                                       *
 * ------------------------------------------------------------------ */

const tentativas = new Map();
const JANELA_MS = 60 * 1000;
const LIMITE = 5;

function limitarLogin(req, res, proximo) {
  const chave = req.ip || 'desconhecido';
  const agora = Date.now();

  const registro = tentativas.get(chave);

  if (!registro || agora - registro.inicio > JANELA_MS) {
    tentativas.set(chave, { inicio: agora, contagem: 1 });
    return proximo();
  }

  registro.contagem += 1;

  if (registro.contagem > LIMITE) {
    const faltam = Math.ceil((JANELA_MS - (agora - registro.inicio)) / 1000);
    return res.status(429).json({
      erro: 'Muitas tentativas. Tente de novo em ' + faltam + ' segundo(s).'
    });
  }

  proximo();
}

/* limpeza periódica, para o mapa não crescer sem fim */
setInterval(function () {
  const agora = Date.now();
  for (const [chave, registro] of tentativas) {
    if (agora - registro.inicio > JANELA_MS) tentativas.delete(chave);
  }
}, JANELA_MS).unref();

module.exports = {
  gerarHash, conferirSenha, garantirAdminInicial,
  exigirLogin, exigirAdmin, ehAdmin, limitarLogin,
  ehSomenteLeitura, barrarSomenteLeitura,
  CUSTO_BCRYPT
};
