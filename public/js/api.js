'use strict';

/**
 * Ponte com o servidor.
 *
 * Mantém a mesma forma do antigo window.api do Electron, de propósito: as
 * telas continuam chamando window.api.demandas.listarPeriodo(...) e não
 * precisam saber que agora existe uma rede no meio.
 */
(function () {
  const BASE = '/api';

  function ehErroDeRede(erro) {
    return erro instanceof TypeError;
  }

  async function pedir(metodo, caminho, corpo) {
    let resposta;

    try {
      resposta = await fetch(BASE + caminho, {
        method: metodo,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        credentials: 'same-origin'
      });
    } catch (erro) {
      if (ehErroDeRede(erro)) {
        throw new Error('Sem conexão com o servidor. Verifique a rede e tente de novo.');
      }
      throw erro;
    }

    /* Sessão caiu: volta para o login sem deixar a tela em estado quebrado. */
    if (resposta.status === 401 && caminho !== '/sessao') {
      window.location.href = '/login';
      throw new Error('Sessão expirada.');
    }

    if (resposta.status === 204) return null;

    let dados = null;
    try {
      dados = await resposta.json();
    } catch (erro) {
      if (!resposta.ok) throw new Error('Falha ' + resposta.status + ' no servidor.');
      return null;
    }

    if (!resposta.ok) {
      const erro = new Error((dados && dados.erro) || ('Falha ' + resposta.status + '.'));
      erro.status = resposta.status;
      throw erro;
    }

    return dados;
  }

  function busca(parametros) {
    const partes = [];
    for (const chave of Object.keys(parametros)) {
      const valor = parametros[chave];
      if (valor === null || valor === undefined || valor === '' || valor === false) continue;
      partes.push(encodeURIComponent(chave) + '=' + encodeURIComponent(valor));
    }
    return partes.length ? '?' + partes.join('&') : '';
  }

  window.api = {
    sessao: {
      atual: function () { return pedir('GET', '/sessao'); },
      entrar: function (usuario, senha) { return pedir('POST', '/sessao', { usuario: usuario, senha: senha }); },
      sair: function () { return pedir('DELETE', '/sessao'); },
      trocarSenha: function (atual, nova) {
        return pedir('POST', '/minha-senha', { atual: atual, nova: nova });
      }
    },

    usuarios: {
      listar: function () { return pedir('GET', '/usuarios'); },
      criar: function (dados) { return pedir('POST', '/usuarios', dados); },
      redefinirSenha: function (id, senha) { return pedir('POST', '/usuarios/' + id + '/senha', { senha: senha }); },
      definirAtivo: function (id, ativo) { return pedir('POST', '/usuarios/' + id + '/ativo', { ativo: ativo }); }
    },

    clientes: {
      listar: function (opcoes) {
        const o = opcoes || {};
        return pedir('GET', '/clientes' + busca({
          incluirArquivados: o.incluirArquivados ? 1 : null,
          somenteArquivados: o.somenteArquivados ? 1 : null
        }));
      },
      criar: function (dados) { return pedir('POST', '/clientes', dados); },
      atualizar: function (id, dados) { return pedir('PUT', '/clientes/' + id, dados); },
      arquivar: function (id) { return pedir('POST', '/clientes/' + id + '/arquivar'); },
      desarquivar: function (id) { return pedir('POST', '/clientes/' + id + '/desarquivar'); },
      resumo: function (id) { return pedir('GET', '/clientes/' + id + '/resumo'); }
    },

    tags: {
      listar: function (opcoes) {
        const o = opcoes || {};
        return pedir('GET', '/tags' + busca({ incluirArquivadas: o.incluirArquivadas ? 1 : null }));
      },
      criar: function (dados) { return pedir('POST', '/tags', dados); },
      atualizar: function (id, dados) { return pedir('PUT', '/tags/' + id, dados); },
      arquivar: function (id) { return pedir('POST', '/tags/' + id + '/arquivar'); },
      desarquivar: function (id) { return pedir('POST', '/tags/' + id + '/desarquivar'); },
      reordenar: function (ids) { return pedir('POST', '/tags/reordenar', { ids: ids }); },
      emUso: async function (id) {
        const r = await pedir('GET', '/tags/' + id + '/uso');
        return r.total;
      }
    },

    demandas: {
      listarPeriodo: function (inicio, fim, opcoes) {
        const o = opcoes || {};
        return pedir('GET', '/demandas' + busca({
          inicio: inicio, fim: fim,
          incluirArquivados: o.incluirArquivados ? 1 : null,
          clienteId: o.clienteId || null
        }));
      },
      obter: function (id) { return pedir('GET', '/demandas/' + id); },
      criar: function (dados) { return pedir('POST', '/demandas', dados); },
      criarVarias: function (lista) { return pedir('POST', '/demandas/lote', { demandas: lista }); },
      atualizar: function (id, dados) { return pedir('PUT', '/demandas/' + id, dados); },
      avancarStatus: function (id) { return pedir('POST', '/demandas/' + id + '/status'); },
      definirLink: function (id, link) { return pedir('POST', '/demandas/' + id + '/link', { link: link }); },
      excluir: function (id) { return pedir('DELETE', '/demandas/' + id); },
      duplicar: function (id, data) { return pedir('POST', '/demandas/' + id + '/duplicar', { data: data }); },
      mover: function (id, clienteId, data, posicao) {
        return pedir('POST', '/demandas/' + id + '/mover', {
          clienteId: clienteId, data: data, posicao: posicao
        });
      }
    },

    prefs: {
      tudo: function () { return pedir('GET', '/preferencias'); },
      definir: function (chave, valor) {
        return pedir('PUT', '/preferencias/' + encodeURIComponent(chave), { valor: valor });
      }
    },

    importar: {
      previa: function (conteudo, arquivo) {
        return pedir('POST', '/importar/previa', { conteudo: conteudo, arquivo: arquivo });
      },
      aplicar: function (conteudo, arquivo) {
        return pedir('POST', '/importar/aplicar', { conteudo: conteudo, arquivo: arquivo });
      }
    },

    /** Link agora abre em aba nova, e não pelo shell do sistema. */
    abrirLink: function (url) {
      const limpo = String(url || '').trim();
      if (limpo === '') return Promise.resolve(false);

      const alvo = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(limpo) ? limpo : 'https://' + limpo;
      if (!/^https?:/i.test(alvo)) {
        return Promise.reject(new Error('Só é possível abrir endereços http ou https.'));
      }

      window.open(alvo, '_blank', 'noopener');
      return Promise.resolve(true);
    }
  };
})();
