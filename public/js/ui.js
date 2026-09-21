'use strict';

/* ------------------------------------------------------------------ *
 * Criação de elementos                                                *
 * ------------------------------------------------------------------ */

/**
 * el('div', { class: 'x', onclick: fn }, ['texto', outroNo])
 * Atributos que começam com "on" viram addEventListener.
 */
function el(tag, atributos, filhos) {
  const no = document.createElement(tag);

  if (atributos) {
    for (const chave of Object.keys(atributos)) {
      const valor = atributos[chave];
      if (valor === null || valor === undefined || valor === false) continue;

      if (chave.slice(0, 2) === 'on' && typeof valor === 'function') {
        no.addEventListener(chave.slice(2), valor);
      } else if (chave === 'texto') {
        no.textContent = String(valor);
      } else if (chave === 'html') {
        no.innerHTML = valor;
      } else if (chave === 'value' && 'value' in no) {
        /* textarea ignora value como atributo: o conteudo vem da propriedade */
        no.value = valor;
      } else if (chave === 'estilo') {
        Object.assign(no.style, valor);
      } else if (chave === 'dados') {
        for (const d of Object.keys(valor)) no.dataset[d] = valor[d];
      } else if (valor === true) {
        no.setAttribute(chave, '');
      } else {
        no.setAttribute(chave, String(valor));
      }
    }
  }

  if (filhos !== undefined && filhos !== null) {
    const lista = Array.isArray(filhos) ? filhos : [filhos];
    for (const filho of lista) {
      if (filho === null || filho === undefined || filho === false) continue;
      no.appendChild(typeof filho === 'string' || typeof filho === 'number'
        ? document.createTextNode(String(filho))
        : filho);
    }
  }

  return no;
}

function limpar(no) {
  while (no.firstChild) no.removeChild(no.firstChild);
  return no;
}

/* ------------------------------------------------------------------ *
 * Modal sobreposto                                                    *
 * ------------------------------------------------------------------ */

const modaisAbertos = [];

/**
 * abrirModal({ titulo, corpo, rodape, largura, aoFechar })
 * Fecha por Esc, pelo X e por clique no fundo escurecido.
 */
/**
 * Fecha um painel ao arrastá-lo para baixo.
 *
 * Só conta o gesto que começa perto do topo do painel — no puxador ou no
 * cabeçalho. Se valesse em qualquer ponto, rolar uma lista comprida dentro do
 * painel fecharia o painel em vez de rolar, que é o erro clássico desse
 * padrão.
 *
 * Também não conta quando o conteúdo já está rolado: aí o dedo para baixo é
 * intenção de voltar ao topo da lista.
 */
function fecharAoDeslizar(painel, aoFechar) {
  let inicioY = null;
  let arrastando = false;

  painel.addEventListener('touchstart', function (evento) {
    if (evento.touches.length !== 1) return;

    const toque = evento.touches[0];
    const caixa = painel.getBoundingClientRect();
    const pertoDoTopo = toque.clientY - caixa.top < 72;

    const rolavel = evento.target.closest('.modal-corpo, .mais-lista');
    const jaRolado = rolavel && rolavel.scrollTop > 0;

    if (!pertoDoTopo || jaRolado) return;

    inicioY = toque.clientY;
    arrastando = true;
  }, { passive: true });

  painel.addEventListener('touchmove', function (evento) {
    if (!arrastando || inicioY === null) return;

    const distancia = evento.touches[0].clientY - inicioY;
    if (distancia <= 0) return;

    painel.style.transform = 'translateY(' + distancia + 'px)';
    painel.style.transition = 'none';
  }, { passive: true });

  function soltar(evento) {
    if (!arrastando) return;
    arrastando = false;

    const fim = evento.changedTouches && evento.changedTouches[0];
    const distancia = fim && inicioY !== null ? fim.clientY - inicioY : 0;
    inicioY = null;

    painel.style.transition = '';

    /* 90px é o limiar: menos que isso é toque trêmulo, não intenção */
    if (distancia > 90) {
      aoFechar();
      return;
    }

    painel.style.transform = '';
  }

  painel.addEventListener('touchend', soltar);
  painel.addEventListener('touchcancel', soltar);
}

function abrirModal(opcoes) {
  const config = opcoes || {};

  const janela = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });

  /* No celular o modal vira painel inferior e ocupa a largura toda: uma
     largura máxima em pixels ali só deixaria margens inúteis nas laterais. */
  if (config.largura && !Dispositivo.ehMobile()) janela.style.maxWidth = config.largura;

  const fundo = el('div', { class: 'modal-fundo' }, [janela]);

  const controle = {
    elemento: janela,
    fechar: function () {
      const indice = modaisAbertos.indexOf(controle);
      if (indice === -1) return;
      modaisAbertos.splice(indice, 1);
      fundo.classList.add('saindo');
      window.setTimeout(function () { fundo.remove(); }, 90);
      if (typeof config.aoFechar === 'function') config.aoFechar();
    }
  };

  const cabecalho = el('div', { class: 'modal-topo' }, [
    el('h2', { class: 'modal-titulo', texto: config.titulo || '' }),
    el('button', {
      class: 'botao-icone modal-fechar',
      type: 'button',
      title: 'Fechar (Esc)',
      'aria-label': 'Fechar',
      onclick: controle.fechar
    }, ['\u00D7'])
  ]);

  /* o puxador \u00E9 a dica visual de que o painel desce com o dedo */
  if (Dispositivo.ehMobile()) {
    janela.appendChild(el('div', { class: 'folha-puxador', 'aria-hidden': 'true' }));
    fecharAoDeslizar(janela, controle.fechar);
  }

  const corpo = el('div', { class: 'modal-corpo' });
  if (config.corpo) corpo.appendChild(config.corpo);

  janela.appendChild(cabecalho);
  janela.appendChild(corpo);
  if (config.rodape) janela.appendChild(el('div', { class: 'modal-rodape' }, config.rodape));

  fundo.addEventListener('mousedown', function (evento) {
    if (evento.target === fundo) controle.fechar();
  });

  document.body.appendChild(fundo);
  modaisAbertos.push(controle);

  /* Foco automático só em campo de formulário. Botão não recebe foco sozinho:
     um botão que só aparece no hover ficaria visível de saída.

     No celular o foco automático abre o teclado por cima do painel e esconde
     metade do formulário antes de a pessoa ler o que ele pede. Lá o foco é
     de quem toca. */
  if (!Dispositivo.ehMobile()) {
    const focavel = janela.querySelector('input:not([type="hidden"]), select, textarea');
    if (focavel) focavel.focus();
  }

  return controle;
}

document.addEventListener('keydown', function (evento) {
  if (evento.key === 'Escape' && modaisAbertos.length > 0) {
    modaisAbertos[modaisAbertos.length - 1].fechar();
  }
});

/* ------------------------------------------------------------------ *
 * Confirmação                                                         *
 * ------------------------------------------------------------------ */

function confirmar(opcoes) {
  const config = opcoes || {};
  return new Promise(function (resolver) {
    let respondido = false;
    const responder = function (valor) {
      if (respondido) return;
      respondido = true;
      resolver(valor);
    };

    const modal = abrirModal({
      titulo: config.titulo || 'Confirmar',
      largura: '440px',
      corpo: el('p', { class: 'texto-fraco', texto: config.texto || '' }),
      aoFechar: function () { responder(false); },
      rodape: [
        el('button', {
          class: 'botao',
          type: 'button',
          onclick: function () { responder(false); modal.fechar(); }
        }, [config.rotuloCancelar || 'Cancelar']),
        el('button', {
          class: 'botao ' + (config.perigo ? 'botao-perigo' : 'botao-principal'),
          type: 'button',
          onclick: function () { responder(true); modal.fechar(); }
        }, [config.rotuloOk || 'Confirmar'])
      ]
    });
  });
}

/* ------------------------------------------------------------------ *
 * Aviso passageiro                                                    *
 * ------------------------------------------------------------------ */

function aviso(mensagem, tipo) {
  let pilha = document.getElementById('avisos');
  if (!pilha) {
    pilha = el('div', { class: 'avisos', id: 'avisos' });
    document.body.appendChild(pilha);
  }

  const nota = el('div', { class: 'aviso' + (tipo ? ' aviso-' + tipo : ''), texto: mensagem });
  pilha.appendChild(nota);

  window.setTimeout(function () {
    nota.classList.add('saindo');
    window.setTimeout(function () { nota.remove(); }, 200);
  }, tipo === 'erro' ? 5000 : 2600);
}

/* ------------------------------------------------------------------ *
 * Campos de formulário                                                *
 * ------------------------------------------------------------------ */

function campo(rotulo, controleInterno, dica) {
  return el('label', { class: 'campo' }, [
    el('span', { class: 'campo-rotulo', texto: rotulo }),
    controleInterno,
    dica ? el('span', { class: 'campo-dica', texto: dica }) : null
  ]);
}

function entrada(atributos) {
  return el('input', Object.assign({ class: 'entrada', type: 'text', autocomplete: 'off' }, atributos || {}));
}

function areaTexto(atributos) {
  return el('textarea', Object.assign({ class: 'entrada area', rows: 3 }, atributos || {}));
}

/**
 * Menu de três pontos para as ações de um card.
 *
 * No celular três ou quatro botões lado a lado dentro de um card ou ficam
 * pequenos demais para acertar com o polegar, ou tomam a linha inteira. Aqui
 * eles viram um alvo só, e as ações abrem numa folha com altura de toque
 * confortável.
 *
 * Recebe [{ rotulo, aoEscolher, perigo }] e devolve o botão pronto.
 */
function menuDeAcoes(acoes, opcoes) {
  const config = opcoes || {};
  const itens = acoes.filter(Boolean);

  const botao = el('button', {
    class: 'botao-icone menu-acoes',
    type: 'button',
    'aria-label': config.rotulo || 'Ações',
    'aria-haspopup': 'true'
  }, ['⋯']);

  botao.addEventListener('click', function (evento) {
    evento.stopPropagation();

    const lista = el('div', { class: 'acoes-folha-lista' }, itens.map(function (acao) {
      return el('button', {
        class: 'acoes-folha-item' + (acao.perigo ? ' acoes-folha-perigo' : ''),
        type: 'button',
        disabled: acao.desabilitado || false,
        onclick: function () {
          modal.fechar();
          acao.aoEscolher();
        }
      }, [
        el('span', { texto: acao.rotulo }),
        acao.descricao ? el('span', { class: 'acoes-folha-descricao', texto: acao.descricao }) : null
      ]);
    }));

    const modal = abrirModal({
      titulo: config.titulo || 'Ações',
      largura: '420px',
      corpo: lista,
      rodape: [
        el('button', {
          class: 'botao botao-largo', type: 'button',
          onclick: function () { modal.fechar(); }
        }, ['Cancelar'])
      ]
    });
  });

  return botao;
}

function vazio(mensagem, complemento) {
  return el('div', { class: 'estado-vazio' }, [
    el('div', { class: 'estado-vazio-titulo', texto: mensagem }),
    complemento ? el('div', { class: 'estado-vazio-texto', texto: complemento }) : null
  ]);
}

window.UI = {
  el: el,
  limpar: limpar,
  abrirModal: abrirModal,
  fecharAoDeslizar: fecharAoDeslizar,
  confirmar: confirmar,
  aviso: aviso,
  menuDeAcoes: menuDeAcoes,
  campo: campo,
  entrada: entrada,
  areaTexto: areaTexto,
  vazio: vazio
};
