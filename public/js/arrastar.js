'use strict';

/**
 * Arrastar e soltar de cards entre células.
 * Serve a visão semanal (outro dia e outro cliente) e a mensal (outro dia).
 *
 * O dado do card fica numa variável de módulo porque, durante o dragover,
 * o dataTransfer não deixa ler o conteúdo - só no drop. E o realce da célula
 * de destino precisa da informação antes disso.
 */
(function () {
  let arrastando = null;

  /* dragleave dispara também ao passar por cima dos filhos da célula.
     Um contador por elemento evita o realce piscando. */
  const contadores = new WeakMap();

  function emArrasto() {
    return arrastando;
  }

  function tornarArrastavel(elemento, demanda) {
    elemento.setAttribute('draggable', 'true');

    elemento.addEventListener('dragstart', function (evento) {
      arrastando = {
        id: demanda.id,
        clienteId: demanda.cliente_id,
        data: demanda.data,
        elemento: elemento
      };

      evento.dataTransfer.effectAllowed = 'move';
      evento.dataTransfer.setData('text/plain', String(demanda.id));
      elemento.classList.add('arrastando');
      document.body.classList.add('arrastando-algo');
      evento.stopPropagation();
    });

    elemento.addEventListener('dragend', function () {
      elemento.classList.remove('arrastando');
      document.body.classList.remove('arrastando-algo');
      for (const alvo of document.querySelectorAll('.alvo-ativo')) {
        alvo.classList.remove('alvo-ativo');
        contadores.set(alvo, 0);
      }
      arrastando = null;
    });
  }

  /**
   * tornarAlvo(elemento, {
   *   clienteId,          cliente da célula (null na visão mensal, que não troca de cliente)
   *   data,               dia da célula
   *   seletorCartoes,     como achar os cards já dentro, para calcular a posição
   *   aoSoltar            função(idDemanda, clienteId, data, posicao)
   * })
   */
  function tornarAlvo(elemento, opcoes) {
    const config = opcoes || {};
    contadores.set(elemento, 0);

    function marcar(ligado) {
      elemento.classList.toggle('alvo-ativo', ligado);
    }

    elemento.addEventListener('dragover', function (evento) {
      if (!arrastando) return;
      evento.preventDefault();
      evento.dataTransfer.dropEffect = 'move';
    });

    elemento.addEventListener('dragenter', function (evento) {
      if (!arrastando) return;
      evento.preventDefault();
      contadores.set(elemento, (contadores.get(elemento) || 0) + 1);
      marcar(true);
    });

    elemento.addEventListener('dragleave', function () {
      if (!arrastando) return;
      const restante = (contadores.get(elemento) || 0) - 1;
      contadores.set(elemento, restante);
      if (restante <= 0) marcar(false);
    });

    elemento.addEventListener('drop', async function (evento) {
      evento.preventDefault();
      evento.stopPropagation();
      contadores.set(elemento, 0);
      marcar(false);

      const solto = arrastando;
      arrastando = null;
      if (!solto) return;

      const clienteDestino = config.clienteId === null || config.clienteId === undefined
        ? solto.clienteId
        : config.clienteId;

      const posicao = config.seletorCartoes
        ? posicaoNaLista(elemento, config.seletorCartoes, evento.clientY, solto.id)
        : null;

      /* soltou exatamente onde já estava: nada a gravar */
      if (clienteDestino === solto.clienteId && config.data === solto.data && posicao === null) return;

      if (typeof config.aoSoltar === 'function') {
        await config.aoSoltar(solto.id, clienteDestino, config.data, posicao);
      }
    });
  }

  /** Índice onde o card deve entrar, pela metade da altura de cada vizinho. */
  function posicaoNaLista(celula, seletor, alturaDoMouse, idArrastado) {
    const cartoes = Array.from(celula.querySelectorAll(seletor)).filter(function (no) {
      return no.dataset.id !== String(idArrastado);
    });

    for (let i = 0; i < cartoes.length; i += 1) {
      const area = cartoes[i].getBoundingClientRect();
      if (alturaDoMouse < area.top + area.height / 2) return i;
    }
    return cartoes.length;
  }

  window.Arrastar = {
    tornarArrastavel: tornarArrastavel,
    tornarAlvo: tornarAlvo,
    emArrasto: emArrasto
  };
})();
