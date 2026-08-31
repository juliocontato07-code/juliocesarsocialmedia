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
function abrirModal(opcoes) {
  const config = opcoes || {};

  const janela = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  if (config.largura) janela.style.maxWidth = config.largura;

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
     um botão que só aparece no hover ficaria visível de saída. */
  const focavel = janela.querySelector('input:not([type="hidden"]), select, textarea');
  if (focavel) focavel.focus();

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
  confirmar: confirmar,
  aviso: aviso,
  campo: campo,
  entrada: entrada,
  areaTexto: areaTexto,
  vazio: vazio
};
