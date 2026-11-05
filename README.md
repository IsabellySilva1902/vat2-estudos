# vat2-estudos

Plataforma de estudo espaçado e simulados para a VAT2 (4º semestre de Medicina, 2026.2).

- **Hoje**: o que estudar e revisar no dia, com contagem regressiva das provas.
- **Calendário**: plano de 05/11 a 04/12, com exportação para o Google Agenda (.ics).
- **Matérias**: situação de cada assunto, acerto nas questões e link para o notebook do NotebookLM.
- **Simulados**: questões com justificativa por alternativa; o acerto ajusta a próxima revisão.

Site estático (HTML/CSS/JS, sem build), publicado pelo GitHub Pages.

## Estrutura
- `data/plano.json`: matérias, datas das provas, assuntos e o plano dia a dia.
- `data/questoes/<materia>.json`: banco de questões de cada matéria.
- O progresso fica no navegador e pode ser sincronizado entre aparelhos por um Gist privado (aba Ajustes).
