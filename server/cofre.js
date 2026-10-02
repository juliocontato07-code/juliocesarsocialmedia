'use strict';

/**
 * O cofre: cifrar e decifrar as senhas das contas dos clientes.
 *
 * Isto não é o mesmo problema da senha de login, e por isso não usa a mesma
 * ferramenta. A senha de login é bcrypt porque ninguém precisa lê-la de volta
 * — o servidor só precisa saber se a que a pessoa digitou bate. A senha do
 * Instagram do cliente precisa voltar em texto, porque alguém vai digitá-la
 * no Instagram. Hash não serve para isso; cifra serve.
 *
 * AES-256-GCM, com IV novo a cada gravação e a tag de autenticação guardada
 * junto. A tag é o que separa "cifrado" de "cifrado e íntegro": sem conferi-la,
 * uma alteração no texto cifrado devolveria lixo silenciosamente em vez de
 * erro.
 *
 * A chave vive só no ambiente. Não entra no banco, não entra no repositório,
 * não aparece em log — nem o valor, nem o tamanho, nem um pedaço.
 */

const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';
const BYTES_DA_CHAVE = 32;
const BYTES_DO_IV = 12;   /* 96 bits: o tamanho que o GCM foi desenhado para usar */

/* Lida uma vez na subida. Trocar a variável exige reiniciar, que é o
   comportamento certo: chave trocada a quente deixaria metade dos registros
   ilegíveis sem ninguém perceber. */
let chave = null;
let motivo = 'CREDENTIALS_KEY não definida';

/**
 * Aceita hexadecimal ou base64, porque as duas são formas normais de escrever
 * 32 bytes num painel de variáveis de ambiente, e obrigar a escolher uma só
 * geraria um erro de digitação por mês.
 */
function interpretarChave(bruto) {
  const limpo = String(bruto || '').trim();
  if (limpo === '') return null;

  if (/^[0-9a-fA-F]+$/.test(limpo) && limpo.length === BYTES_DA_CHAVE * 2) {
    return Buffer.from(limpo, 'hex');
  }

  if (/^[A-Za-z0-9+/=_-]+$/.test(limpo)) {
    const bytes = Buffer.from(limpo, 'base64');
    if (bytes.length === BYTES_DA_CHAVE) return bytes;
  }

  return null;
}

function iniciar() {
  const bruto = process.env.CREDENTIALS_KEY;

  if (!bruto || String(bruto).trim() === '') {
    chave = null;
    motivo = 'CREDENTIALS_KEY não definida';
    return { pronto: false, motivo: motivo };
  }

  const bytes = interpretarChave(bruto);

  if (!bytes) {
    chave = null;
    /* a mensagem fala do formato e nunca do valor */
    motivo = 'CREDENTIALS_KEY precisa ter 32 bytes, em hexadecimal (64 caracteres) ' +
             'ou base64 (44 caracteres)';
    return { pronto: false, motivo: motivo };
  }

  chave = bytes;
  motivo = null;
  return { pronto: true, motivo: null };
}

function disponivel() {
  return chave !== null;
}

/** O que a interface mostra quando o cofre está fechado. Nunca o valor. */
function indisponivel() {
  return motivo;
}

function exigirChave() {
  if (!chave) {
    const erro = new Error('O cofre de acessos está indisponível: ' + motivo + '.');
    erro.codigo = 503;   /* o middleware de erro lê .codigo */
    throw erro;
  }
}

/**
 * Devolve as três partes que vão para o banco.
 *
 * Nunca devolve nem registra o texto original. Se esta função falhar, o erro
 * não carrega a senha junto — é o tipo de descuido que coloca credencial de
 * cliente num log de servidor para sempre.
 */
function cifrar(senha) {
  exigirChave();

  const texto = String(senha === null || senha === undefined ? '' : senha);
  if (texto === '') throw new Error('A senha é obrigatória.');

  const iv = crypto.randomBytes(BYTES_DO_IV);
  const cifrador = crypto.createCipheriv(ALGORITMO, chave, iv);

  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);

  return {
    senha_cifrada: cifrado.toString('base64'),
    senha_iv: iv.toString('base64'),
    senha_tag: cifrador.getAuthTag().toString('base64')
  };
}

/**
 * O caminho inverso, e o único lugar do sistema onde uma senha de cliente
 * volta a existir em texto.
 *
 * `final()` é quem confere a tag: texto cifrado adulterado, IV trocado ou
 * chave diferente da que cifrou saem daqui como erro, não como texto errado.
 */
function decifrar(registro) {
  exigirChave();

  try {
    const decifrador = crypto.createDecipheriv(
      ALGORITMO, chave, Buffer.from(registro.senha_iv, 'base64')
    );
    decifrador.setAuthTag(Buffer.from(registro.senha_tag, 'base64'));

    return Buffer.concat([
      decifrador.update(Buffer.from(registro.senha_cifrada, 'base64')),
      decifrador.final()
    ]).toString('utf8');
  } catch (erro) {
    /*
     * A mensagem do crypto é "Unsupported state or unable to authenticate
     * data", que não ajuda ninguém. A causa real é quase sempre uma só: a
     * chave de hoje não é a que cifrou este registro.
     */
    const falha = new Error(
      'Não foi possível abrir esta senha. O registro foi gravado com outra ' +
      'CREDENTIALS_KEY, ou o dado foi alterado no banco.'
    );
    falha.codigo = 409;
    throw falha;
  }
}

module.exports = {
  iniciar, disponivel, indisponivel, cifrar, decifrar,
  BYTES_DA_CHAVE
};
