-- O cofre passa a guardar a senha em texto simples. Decisão do dono do
-- sistema, tomada depois de ver o custo de operar uma chave.
-- Só ADD COLUMN e DROP NOT NULL: nada aqui apaga coluna, tabela ou dado.
-- Nunca edite este arquivo depois de aplicado.

/* ------------------------------------------------------------------ *
 * A coluna nova                                                       *
 * ------------------------------------------------------------------ */

ALTER TABLE cliente_acessos ADD COLUMN senha TEXT;

/* ------------------------------------------------------------------ *
 * As três antigas ficam, sem obrigatoriedade                          *
 * ------------------------------------------------------------------ */

/*
 * senha_cifrada, senha_iv e senha_tag saem de uso mas continuam na tabela.
 *
 * Elas eram NOT NULL, então toda gravação nova quebraria se a obrigatoriedade
 * ficasse. Soltar é o suficiente, e é o que esta migração faz.
 *
 * Não são apagadas porque apagar coluna é a única operação deste arquivo que
 * não teria volta. Hoje não há o que perder — a tabela está vazia, o cofre
 * nunca chegou a gravar em produção —, mas a regra do projeto é que migração
 * não destrói, e abrir exceção quando o risco é zero é como se aprende a
 * abrir exceção quando ele não é. Elas ficam vazias e inertes; o dia em que
 * alguém quiser removê-las, que seja uma decisão própria e não um efeito
 * colateral desta.
 */
ALTER TABLE cliente_acessos ALTER COLUMN senha_cifrada DROP NOT NULL;
ALTER TABLE cliente_acessos ALTER COLUMN senha_iv      DROP NOT NULL;
ALTER TABLE cliente_acessos ALTER COLUMN senha_tag     DROP NOT NULL;
