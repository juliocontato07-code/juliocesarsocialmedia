'use strict';

/**
 * Cache em memória de clientes e tags.
 * Toda tela lê daqui e se inscreve em aoMudar, para que arquivar um cliente
 * numa tela reflita imediatamente em todas as outras.
 */
(function () {
  const ouvintes = [];
  const ouvintesDemandas = [];

  const estado = {
    usuario: null,
    prefs: {},
    clientes: [],           /* ativos */
    clientesArquivados: [],
    tags: [],               /* ativas */
    tagsArquivadas: [],
    carregado: false
  };

  function avisarTodos() {
    for (const ouvinte of ouvintes.slice()) ouvinte(estado);
  }

  async function recarregar() {
    const [sessao, ativos, arquivados, todasAsTags, prefs] = await Promise.all([
      window.api.sessao.atual(),
      window.api.clientes.listar({}),
      window.api.clientes.listar({ somenteArquivados: true }),
      window.api.tags.listar({ incluirArquivadas: true }),
      window.api.prefs.tudo()
    ]);

    estado.usuario = sessao;

    estado.prefs = prefs || {};

    estado.clientes = ativos;
    estado.clientesArquivados = arquivados;
    /* o Postgres devolve booleano, não 0/1: comparar por identidade com
       número esvaziaria as duas listas */
    estado.tags = todasAsTags.filter(function (t) { return !t.arquivada; });
    estado.tagsArquivadas = todasAsTags.filter(function (t) { return Boolean(t.arquivada); });
    estado.carregado = true;

    avisarTodos();
    return estado;
  }

  function aoMudar(funcao) {
    ouvintes.push(funcao);
    return function () {
      const indice = ouvintes.indexOf(funcao);
      if (indice > -1) ouvintes.splice(indice, 1);
    };
  }

  function cliente(id) {
    return estado.clientes.concat(estado.clientesArquivados)
      .find(function (c) { return c.id === id; }) || null;
  }

  function tag(id) {
    return estado.tags.concat(estado.tagsArquivadas)
      .find(function (t) { return t.id === id; }) || null;
  }

  /**
   * Demandas não ficam em cache: cada tela busca só o período que mostra.
   * Este canal existe para uma tela avisar as outras que os dados mudaram.
   */
  function aoMudarDemandas(funcao) {
    ouvintesDemandas.push(funcao);
    return function () {
      const indice = ouvintesDemandas.indexOf(funcao);
      if (indice > -1) ouvintesDemandas.splice(indice, 1);
    };
  }

  function demandasMudaram() {
    for (const ouvinte of ouvintesDemandas.slice()) ouvinte();
  }

  /* ---------------- preferências ---------------- */

  /** Lê uma preferência já convertida de JSON, com padrão. */
  function pref(chave, padrao) {
    const bruto = estado.prefs[chave];
    if (bruto === undefined || bruto === null || bruto === '') return padrao;
    try {
      return JSON.parse(bruto);
    } catch (erro) {
      return bruto;
    }
  }

  /** Grava sem bloquear a interface: falha de preferência não é fatal. */
  function definirPref(chave, valor) {
    const bruto = typeof valor === 'string' ? valor : JSON.stringify(valor);
    estado.prefs[chave] = bruto;
    window.api.prefs.definir(chave, bruto).catch(function () {});
  }

  /** Quem manda é o servidor; isto aqui é só para a interface se ajustar. */
  function ehAdmin() {
    return Boolean(estado.usuario && estado.usuario.papel === 'admin');
  }

  window.Estado = {
    dados: estado,
    ehAdmin: ehAdmin,
    pref: pref,
    definirPref: definirPref,
    recarregar: recarregar,
    aoMudar: aoMudar,
    aoMudarDemandas: aoMudarDemandas,
    demandasMudaram: demandasMudaram,
    cliente: cliente,
    tag: tag
  };
})();
