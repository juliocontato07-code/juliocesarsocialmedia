'use strict';

/**
 * Os acessos de cada cliente: as contas que a agência opera por ele.
 *
 * Uma regra organiza este arquivo inteiro: a senha sai daqui por um caminho só,
 * o de `revelar`. Nenhuma outra função devolve a senha, nem em texto nem
 * cifrada — `SELECAO` não inclui as três colunas do cofre, então não existe o
 * descuido de "esqueci de tirar o campo da resposta". Quem quiser a senha tem
 * de chamar a função que a registra no log.
 */

const bd = require('./db');
const cofre = require('./cofre');

function exec(conexao) {
  return conexao || bd;
}

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/*
 * As colunas que podem sair. senha_cifrada, senha_iv e senha_tag ficam de
 * fora de propósito e não devem ser acrescentadas: texto cifrado que circula
 * é texto cifrado que alguém guarda, e o IV e a tag ao lado dele transformam
 * um vazamento de chave num vazamento de senhas.
 */
const SELECAO = `
  SELECT a.id, a.cliente_id, a.conta, a.login, a.observacoes, a.ordem,
         a.criado_em, a.atualizado_em, a.atualizado_por,
         u.usuario AS atualizado_por_usuario,
         COALESCE(NULLIF(u.nome_completo, ''), u.usuario) AS atualizado_por_nome
    FROM cliente_acessos a
    LEFT JOIN usuarios u ON u.id = a.atualizado_por
`;

function validar(dados) {
  const conta = texto(dados.conta);
  const login = texto(dados.login);

  if (conta === '') throw new Error('Diga de que conta é este acesso.');
  if (conta.length > 80) throw new Error('O nome da conta passou de 80 caracteres.');
  if (login === '') throw new Error('O login é obrigatório.');
  if (login.length > 200) throw new Error('O login passou de 200 caracteres.');

  const observacoes = texto(dados.observacoes);
  if (observacoes.length > 500) throw new Error('As observações passaram de 500 caracteres.');

  return { conta: conta, login: login, observacoes: observacoes };
}

const acessos = {
  /** Lista de um cliente. Sem senha, por construção. */
  async listar(clienteId, conexao) {
    const r = await exec(conexao).query(
      SELECAO + ' WHERE a.cliente_id = $1 ORDER BY a.ordem, a.id', [clienteId]
    );
    return r.rows;
  },

  async obter(id, conexao) {
    const r = await exec(conexao).query(SELECAO + ' WHERE a.id = $1', [id]);
    return r.rows[0] || null;
  },

  async criar(clienteId, dados, usuarioId) {
    const campos = validar(dados);
    const segredo = cofre.cifrar(dados.senha);   /* lança 503 se o cofre estiver fechado */

    const cliente = await bd.uma('SELECT id FROM clientes WHERE id = $1', [clienteId]);
    if (!cliente) throw new Error('Cliente não encontrado.');

    const ordem = await bd.uma(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM cliente_acessos WHERE cliente_id = $1',
      [clienteId]
    );

    const criado = await bd.uma(
      `INSERT INTO cliente_acessos
         (cliente_id, conta, login, senha_cifrada, senha_iv, senha_tag,
          observacoes, ordem, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [clienteId, campos.conta, campos.login,
       segredo.senha_cifrada, segredo.senha_iv, segredo.senha_tag,
       campos.observacoes, ordem.proxima, usuarioId]
    );

    return acessos.obter(criado.id);
  },

  /**
   * Senha em branco mantém a que está lá.
   *
   * Não é conveniência: é o que evita que editar a observação de um acesso
   * exija redigitar uma senha que a pessoa não tem na cabeça, e que ela acabe
   * digitando errado e trancando todo mundo fora da conta.
   */
  async atualizar(id, dados, usuarioId) {
    const campos = validar(dados);
    const trocaSenha = texto(dados.senha) !== '';

    const valores = [id, campos.conta, campos.login, campos.observacoes, usuarioId];
    let sql = `UPDATE cliente_acessos
                  SET conta = $2, login = $3, observacoes = $4,
                      atualizado_por = $5, atualizado_em = now()`;

    if (trocaSenha) {
      const segredo = cofre.cifrar(dados.senha);
      valores.push(segredo.senha_cifrada, segredo.senha_iv, segredo.senha_tag);
      sql += ', senha_cifrada = $6, senha_iv = $7, senha_tag = $8';
    }

    const r = await bd.consultar(sql + ' WHERE id = $1', valores);
    if (r.rowCount === 0) throw new Error('Acesso não encontrado.');

    return acessos.obter(id);
  },

  async excluir(id) {
    const r = await bd.consultar('DELETE FROM cliente_acessos WHERE id = $1', [id]);
    if (r.rowCount === 0) throw new Error('Acesso não encontrado.');
    return { excluido: true };
  },

  async reordenar(clienteId, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { reordenados: 0 };

    return bd.transacao(async function (cx) {
      let n = 0;
      for (let i = 0; i < ids.length; i++) {
        /* o cliente_id na cláusula impede reordenar o acesso de outro cliente
           mandando um id de fora na lista */
        const r = await cx.query(
          'UPDATE cliente_acessos SET ordem = $3 WHERE id = $1 AND cliente_id = $2',
          [Number(ids[i]), clienteId, i]
        );
        n += r.rowCount;
      }
      return { reordenados: n };
    });
  },

  /**
   * O único lugar de onde uma senha sai em texto.
   *
   * Registra antes de devolver: se a gravação do log falhar, a senha não sai.
   * O contrário — devolver e tentar registrar depois — deixaria a porta aberta
   * para uma consulta sem rastro sempre que o banco tossisse.
   */
  async revelar(id, usuarioId, acao) {
    const registro = await bd.uma(
      'SELECT id, conta, senha_cifrada, senha_iv, senha_tag FROM cliente_acessos WHERE id = $1',
      [id]
    );
    if (!registro) throw new Error('Acesso não encontrado.');

    const senha = cofre.decifrar(registro);

    await bd.consultar(
      'INSERT INTO acesso_consultas (acesso_id, usuario_id, acao) VALUES ($1,$2,$3)',
      [id, usuarioId, acao === 'copiou' ? 'copiou' : 'revelou']
    );

    return { id: registro.id, conta: registro.conta, senha: senha };
  },

  /** Histórico recente de um cliente, para o admin ver dentro do bloco. */
  async consultasDoCliente(clienteId, limite) {
    return bd.varias(
      `SELECT q.id, q.acao, q.criado_em, q.acesso_id,
              a.conta,
              COALESCE(NULLIF(u.nome_completo, ''), u.usuario) AS usuario_nome
         FROM acesso_consultas q
         JOIN cliente_acessos a ON a.id = q.acesso_id
         JOIN usuarios u ON u.id = q.usuario_id
        WHERE a.cliente_id = $1
        ORDER BY q.criado_em DESC
        LIMIT $2`,
      [clienteId, Math.min(Number(limite) || 20, 100)]
    );
  }
};

module.exports = { acessos };
