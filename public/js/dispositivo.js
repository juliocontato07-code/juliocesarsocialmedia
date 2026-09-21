'use strict';

/**
 * Qual é o tamanho da tela, para o JavaScript decidir o que montar.
 *
 * O CSS resolve quase tudo sozinho, e é onde a adaptação deve morar sempre que
 * for possível. Este módulo existe para os casos em que o CSS não alcança: a
 * grade de sete colunas da Semanal não é a mesma estrutura em coluna única, e
 * esconder seis colunas com `display: none` deixaria o navegador montando
 * centenas de células invisíveis a cada semana.
 *
 * Os limites são os mesmos do CSS, escritos uma vez aqui e uma vez lá. Estão
 * em duas linguagens diferentes, então não há como compartilhar a constante —
 * mas estão comentados dos dois lados para quem mudar um lembrar do outro.
 */
(function () {
  /* mesmos valores do bloco responsivo em styles.css */
  const LIMITE_MOBILE = 768;    /* abaixo disto: celular */
  const LIMITE_TABLET = 1024;   /* daqui para cima: desktop */

  const ouvintes = [];
  let faixaAtual = calcularFaixa();

  function largura() {
    return window.innerWidth || document.documentElement.clientWidth;
  }

  function calcularFaixa() {
    const l = largura();
    if (l < LIMITE_MOBILE) return 'mobile';
    if (l < LIMITE_TABLET) return 'tablet';
    return 'desktop';
  }

  function ehMobile() { return faixaAtual === 'mobile'; }
  function ehTablet() { return faixaAtual === 'tablet'; }
  function ehDesktop() { return faixaAtual === 'desktop'; }

  /**
   * Toque de verdade, não largura de tela.
   *
   * Serve para decidir se arrastar e soltar faz sentido: um notebook com tela
   * sensível ao toque tem as duas coisas, e nesse caso o arrastar continua
   * valendo. Só o aparelho que não tem cursor nenhum é que perde.
   */
  function ehToque() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  /** Avisa quando a faixa muda — girar o aparelho, redimensionar a janela. */
  function aoMudarFaixa(funcao) {
    ouvintes.push(funcao);
    return function () {
      const i = ouvintes.indexOf(funcao);
      if (i > -1) ouvintes.splice(i, 1);
    };
  }

  /*
   * Só dispara quando a FAIXA muda, não a cada pixel de redimensionamento.
   * Arrastar a borda da janela no desktop dispara resize dezenas de vezes por
   * segundo, e remontar a tela em cada uma seria inútil e visível.
   */
  window.addEventListener('resize', function () {
    const nova = calcularFaixa();
    if (nova === faixaAtual) return;

    faixaAtual = nova;
    document.body.dataset.faixa = nova;
    for (const ouvinte of ouvintes.slice()) ouvinte(nova);
  });

  /**
   * Atalho na tela inicial, aberto em tela cheia.
   * O iOS usa navigator.standalone; o resto usa a media query.
   */
  function ehAtalhoInstalado() {
    return window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
  }

  window.Dispositivo = {
    faixa: function () { return faixaAtual; },
    ehMobile: ehMobile,
    ehTablet: ehTablet,
    ehDesktop: ehDesktop,
    ehToque: ehToque,
    ehAtalhoInstalado: ehAtalhoInstalado,
    aoMudarFaixa: aoMudarFaixa,
    LIMITE_MOBILE: LIMITE_MOBILE,
    LIMITE_TABLET: LIMITE_TABLET
  };

  /* marca no <body> para o CSS poder distinguir casos que a media query não
     pega sozinha, como o atalho instalado */
  document.addEventListener('DOMContentLoaded', function () {
    document.body.dataset.faixa = faixaAtual;
    if (ehAtalhoInstalado()) document.body.dataset.atalho = 'sim';
    if (ehToque()) document.body.dataset.toque = 'sim';
  });
})();
