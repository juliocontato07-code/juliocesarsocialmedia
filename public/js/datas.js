'use strict';

/**
 * Tudo em texto 'AAAA-MM-DD' e horário local.
 * Nada de toISOString aqui: ele converte para UTC e joga a data um dia para trás
 * em fuso negativo, que é justamente o caso do Brasil.
 */
(function () {
  const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
    'quinta-feira', 'sexta-feira', 'sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function doisDigitos(numero) {
    return (numero < 10 ? '0' : '') + numero;
  }

  function paraTexto(objeto) {
    return objeto.getFullYear() + '-' + doisDigitos(objeto.getMonth() + 1) + '-' + doisDigitos(objeto.getDate());
  }

  function paraObjeto(iso) {
    const partes = String(iso).split('-').map(Number);
    return new Date(partes[0], partes[1] - 1, partes[2]);
  }

  function hoje() {
    return paraTexto(new Date());
  }

  function somarDias(iso, quantidade) {
    const objeto = paraObjeto(iso);
    objeto.setDate(objeto.getDate() + quantidade);
    return paraTexto(objeto);
  }

  function somarMeses(iso, quantidade) {
    const objeto = paraObjeto(iso);
    const diaOriginal = objeto.getDate();
    objeto.setDate(1);
    objeto.setMonth(objeto.getMonth() + quantidade);
    const ultimoDia = new Date(objeto.getFullYear(), objeto.getMonth() + 1, 0).getDate();
    objeto.setDate(Math.min(diaOriginal, ultimoDia));
    return paraTexto(objeto);
  }

  /** Domingo da semana que contém a data. */
  function inicioSemana(iso) {
    const objeto = paraObjeto(iso);
    objeto.setDate(objeto.getDate() - objeto.getDay());
    return paraTexto(objeto);
  }

  /** Sete datas, de domingo a sábado. */
  function semana(isoQualquer) {
    const domingo = inicioSemana(isoQualquer);
    const dias = [];
    for (let i = 0; i < 7; i += 1) dias.push(somarDias(domingo, i));
    return dias;
  }

  function diaDaSemana(iso) { return paraObjeto(iso).getDay(); }
  function diaDoMes(iso) { return paraObjeto(iso).getDate(); }
  function mes(iso) { return paraObjeto(iso).getMonth(); }
  function ano(iso) { return paraObjeto(iso).getFullYear(); }

  function nomeDiaCurto(iso) { return DIAS_CURTOS[diaDaSemana(iso)]; }
  function nomeDiaLongo(iso) { return DIAS_LONGOS[diaDaSemana(iso)]; }
  function nomeMes(indice) { return MESES[indice]; }
  function nomeMesCurto(indice) { return MESES_CURTOS[indice]; }

  function ehHoje(iso) { return iso === hoje(); }
  function ehFimDeSemana(iso) {
    const dia = diaDaSemana(iso);
    return dia === 0 || dia === 6;
  }

  /** "27 de agosto de 2026" */
  function porExtenso(iso) {
    return diaDoMes(iso) + ' de ' + nomeMes(mes(iso)) + ' de ' + ano(iso);
  }

  /** "quinta, 27 de agosto" */
  function comDiaDaSemana(iso) {
    return nomeDiaLongo(iso).replace('-feira', '') + ', ' + diaDoMes(iso) + ' de ' + nomeMes(mes(iso));
  }

  /** "24 a 30 de agosto de 2026" ou "31 de agosto a 6 de setembro de 2026" */
  function intervaloPorExtenso(inicio, fim) {
    if (mes(inicio) === mes(fim) && ano(inicio) === ano(fim)) {
      return diaDoMes(inicio) + ' a ' + diaDoMes(fim) + ' de ' + nomeMes(mes(fim)) + ' de ' + ano(fim);
    }
    if (ano(inicio) === ano(fim)) {
      return diaDoMes(inicio) + ' de ' + nomeMes(mes(inicio)) + ' a ' +
             diaDoMes(fim) + ' de ' + nomeMes(mes(fim)) + ' de ' + ano(fim);
    }
    return porExtenso(inicio) + ' a ' + porExtenso(fim);
  }

  /** "27/08/2026" */
  function curta(iso) {
    return doisDigitos(diaDoMes(iso)) + '/' + doisDigitos(mes(iso) + 1) + '/' + ano(iso);
  }

  function primeiroDiaDoMes(iso) {
    return ano(iso) + '-' + doisDigitos(mes(iso) + 1) + '-01';
  }

  function ultimoDiaDoMes(iso) {
    const ultimo = new Date(ano(iso), mes(iso) + 1, 0);
    return paraTexto(ultimo);
  }

  window.Datas = {
    hoje: hoje,
    paraTexto: paraTexto,
    paraObjeto: paraObjeto,
    somarDias: somarDias,
    somarMeses: somarMeses,
    inicioSemana: inicioSemana,
    semana: semana,
    diaDaSemana: diaDaSemana,
    diaDoMes: diaDoMes,
    mes: mes,
    ano: ano,
    nomeDiaCurto: nomeDiaCurto,
    nomeDiaLongo: nomeDiaLongo,
    nomeMes: nomeMes,
    nomeMesCurto: nomeMesCurto,
    ehHoje: ehHoje,
    ehFimDeSemana: ehFimDeSemana,
    porExtenso: porExtenso,
    comDiaDaSemana: comDiaDaSemana,
    intervaloPorExtenso: intervaloPorExtenso,
    curta: curta,
    primeiroDiaDoMes: primeiroDiaDoMes,
    ultimoDiaDoMes: ultimoDiaDoMes,
    DIAS_CURTOS: DIAS_CURTOS
  };
})();
