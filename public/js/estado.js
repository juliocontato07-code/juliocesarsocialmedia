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
    atribuiveis: [],        /* quem pode receber demanda */
    cargos: [],             /* cargos ativos, do cadastro */
    carregado: false
  };

  /* Os cargos agora vêm do banco: a lista fixa saiu daqui. */
  function nomeCargo(id) {
    const achado = estado.cargos.find(function (c) { return c.id === Number(id); });
    return achado ? achado.nome : '';
  }

  function cargo(id) {
    return estado.cargos.find(function (c) { return c.id === Number(id); }) || null;
  }

  function avisarTodos() {
    for (const ouvinte of ouvintes.slice()) ouvinte(estado);
  }

  async function recarregar() {
    const [sessao, ativos, arquivados, todasAsTags, prefs, atribuiveis, cargos] = await Promise.all([
      window.api.sessao.atual(),
      window.api.clientes.listar({}),
      window.api.clientes.listar({ somenteArquivados: true }),
      window.api.tags.listar({ incluirArquivadas: true }),
      window.api.prefs.tudo(),
      window.api.usuarios.atribuiveis(),
      window.api.cargos.listar({})
    ]);

    estado.usuario = sessao;

    estado.prefs = prefs || {};

    estado.clientes = ativos;
    estado.clientesArquivados = arquivados;
    estado.atribuiveis = atribuiveis || [];
    estado.cargos = cargos || [];
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

  /**
   * Cargo marcado como somente leitura: leitura pura, e isso vale mesmo quando
   * o papel é admin. O cargo é mais restritivo que o papel, nunca menos.
   */
  function ehSomenteLeitura() {
    return Boolean(estado.usuario && estado.usuario.somente_leitura);
  }

  /**
   * Quem manda é o servidor; isto aqui é só para a interface se ajustar.
   *
   * O cargo espectador derruba o admin de propósito: assim toda a interface que
   * já pergunta "ehAdmin?" para mostrar botão de escrita fica correta sem eu
   * precisar reabrir cada tela e acrescentar uma segunda pergunta — que é
   * justamente o tipo de coisa que se esquece em uma tela e vira brecha.
   */
  function ehAdmin() {
    return Boolean(estado.usuario && estado.usuario.papel === 'admin') && !ehSomenteLeitura();
  }

  /**
   * Vê e edita as senhas das contas dos clientes.
   *
   * Vem decidido do servidor, em pode_credenciais, e não é recalculado aqui:
   * a mesma regra escrita em dois lugares é a mesma regra até o dia em que
   * não é, e aí a tela oferece um cofre que o servidor recusa.
   */
  function podeCredenciais() {
    return Boolean(estado.usuario && estado.usuario.pode_credenciais);
  }

  /** O cofre pode estar fechado para todo mundo, por falta da chave no ambiente. */
  function cofreDisponivel() {
    return Boolean(estado.usuario && estado.usuario.cofre_disponivel);
  }

  function cofreMotivo() {
    return (estado.usuario && estado.usuario.cofre_motivo) || null;
  }

  /** O mínimo que quem não é somente leitura pode fazer: status e link. */
  function podeEscrever() {
    return !ehSomenteLeitura();
  }

  function usuarioAtribuivel(id) {
    return estado.atribuiveis.find(function (u) { return u.id === id; }) || null;
  }

  window.Estado = {
    dados: estado,
    ehAdmin: ehAdmin,
    ehSomenteLeitura: ehSomenteLeitura,
    podeEscrever: podeEscrever,
    podeCredenciais: podeCredenciais,
    cofreDisponivel: cofreDisponivel,
    cofreMotivo: cofreMotivo,
    usuarioAtribuivel: usuarioAtribuivel,
    nomeCargo: nomeCargo,
    cargo: cargo,
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
