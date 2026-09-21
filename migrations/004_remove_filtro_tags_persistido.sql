-- O filtro de tags da Semanal deixou de ser uma escolha guardada e passou a
-- ser derivado do cargo de quem entra, recalculado a cada carregamento.
-- Nunca edite este arquivo depois de aplicado.

/*
 * Tira as linhas de `semanal.tagsOcultas` do cadastro de preferências.
 *
 * O código já não lê essa chave — o filtro da Semanal agora nasce do cargo —
 * então estas linhas não mudam mais o comportamento de nada. Elas saem porque
 * preferência morta é pior que preferência nenhuma: daqui a seis meses alguém
 * lê "tagsOcultas" no banco, conclui que o filtro é persistido, e passa uma
 * tarde procurando por que mexer nela não muda a tela.
 *
 * É a única coisa que esta migração faz. Nenhuma estrutura muda, e nenhuma
 * outra preferência é tocada: o filtro de clientes da Mensal, os filtros da
 * Lista, o mês do Dashboard e a última aba continuam sendo escolhas de cada
 * pessoa e continuam gravados.
 */
DELETE FROM preferencias WHERE chave = 'semanal.tagsOcultas';
