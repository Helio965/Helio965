# Estatísticas do perfil

Como os números e gráficos do README são calculados, atualizados e verificados.
Este arquivo não aparece no perfil; ele existe para manutenção.

## Métrica central: atividade dos projetos

Todos os cartões próprios do perfil leem um único arquivo, `activity.json`,
publicado na branch `output-stats`. Ele contém:

| Campo | Significado |
| --- | --- |
| `commits.total` | Commits distintos, sem merges, em todas as branches dos repositórios da conta |
| `commits.last_30_days` | O mesmo, nos últimos 30 dias (hoje e os 29 anteriores) |
| `commits.active_days`, `commits.first_day` | Dias com pelo menos um commit e o primeiro deles |
| `streaks.current` / `streaks.longest` | Dias consecutivos e maior sequência, com início e fim |
| `daily` | Commits por dia |
| `languages` | Commits por dia, agrupados pela linguagem principal do repositório |
| `repositories` | Repositórios analisados (públicos, privados, arquivados, vazios, forks ignorados) |
| `coverage.private` | `complete` com `PROFILE_STATS_TOKEN`; `not_configured` sem ele |
| `excluded` | Merges, commits de automação, cópias de rebase e branches de imagens ignorados |
| `generated_at`, `today` | Momento da coleta e o dia correspondente em Brasília |

Regras de contagem (`scripts/lib/activity.js`):

- Entram commits de qualquer autor: a conta Helio965, Claude, Codex, colaboradores e outras ferramentas. A autoria registrada no Git não é alterada.
- Todas as branches são lidas, não só a `main`. Cada SHA conta uma vez, mesmo que apareça em várias branches ou repositórios.
- Commits de merge não contam, porque repetem trabalho já contado. Cópias de rebase ou cherry-pick (mesmo autor, data de autoria e título) contam uma vez por repositório.
- Ficam de fora os forks, as branches `output*` deste repositório (imagens geradas) e os commits do `github-actions[bot]`.
- O dia de cada commit é a data de autoria (quando o trabalho foi feito) no fuso `America/Sao_Paulo`. Commits com data no futuro usam a data do commit ou são descartados.
- A sequência atual continua viva enquanto ontem teve commits, mesmo que hoje ainda não tenha. Em caso de empate, a maior sequência é a mais antiga, como no Streak Stats.

## Fluxo de atualização

1. `generate profile stats` (`.github/workflows/profile-stats.yml`), diariamente às 00:37 de Brasília, por execução manual ou por push em `main`:
   - roda os testes (`npm test`);
   - restaura os arquivos publicados, para que um gerador que falhe mantenha a versão anterior;
   - coleta a atividade (`scripts/repository-activity.js`) e gera os dois cartões (`scripts/render-profile-cards.js`), gravando `activity.json` e os quatro SVGs juntos;
   - gera as linguagens e os summary cards;
   - confere todas as imagens (`scripts/check-profile-images.js`) e publica em `output-stats`;
   - termina em vermelho se algum cartão manteve a versão do dia anterior.
2. Ao terminar, dispara `generate 3d contributions` e `generate maeul village`, que leem o mesmo `activity.json`.

Os demais jogos têm agendas próprias e continuam independentes.

## Cartões e gráficos

| Imagem | Fonte | Observação |
| --- | --- | --- |
| Estatísticas do GitHub (`stats*.svg`) | Commits: atividade dos projetos. Estrelas, PRs, issues, “contribuiu para”: GitHub | Renderizado pela própria biblioteca do GitHub Readme Stats (`@stats-organization/github-readme-stats-core`, versão fixada); o rank é recalculado com a mesma fórmula e o total de commits |
| Sequência (`all-activity*.svg`) | Atividade dos projetos | Réplica do Streak Stats (pt_BR, temas default e github-dark-blue) |
| Contribuições em 3D | Atividade dos projetos | `github-profile-3d-contrib` consulta `scripts/contribution-calendar-endpoint.js` pela opção `GITHUB_ENDPOINT`; o calendário é trocado e o rótulo vira “commits” (`.github/profile-3d/settings.json`) |
| Vila Maeul | Atividade dos projetos | Snapshot gerado por `scripts/maeul-snapshot.js`, lido pela opção `input` |
| Linguagens, summary cards | GitHub | Contribuições oficiais e repositórios visíveis ao `GITHUB_TOKEN` |
| Snake, Pac-Man e jogos, Commit Invaders, Breakout, Tetris, Game of Life, GitWorld, Space Shooter | Gráfico oficial de contribuições | Essas actions não oferecem entrada de dados nem endpoint configurável; o README identifica a fonte |

Limitações conhecidas:

- O Commit Invaders escreve “COMMITS” e o GitWorld escreve “commits” e “streak”, mas os dois contam as contribuições oficiais do último ano (o GitWorld sem tolerância para o dia atual). Só daria para mudar interceptando as requisições do código empacotado dessas actions, o que deixaria os jogos frágeis; por isso o README identifica a fonte desses números.
- Os summary cards (linha do tempo, horários, linguagens por commit) usam apenas commits atribuídos à conta no GitHub. A action não aceita outra fonte de dados.
- O 3D e o Maeul mostram o último ano; os cartões mostram o histórico completo. Hoje toda a atividade cabe no último ano, então os totais coincidem.

## Repositórios privados: `PROFILE_STATS_TOKEN`

Sem esse secret, só os repositórios públicos entram na contagem e `coverage.private` fica `not_configured`. A execução mostra um aviso, sem falhar.

Para incluir os privados:

1. Em <https://github.com/settings/personal-access-tokens/new>, crie um **fine-grained token**:
   - Resource owner: `Helio965`;
   - Repository access: **All repositories** (ou selecione todos os seus repositórios);
   - Permissions › Repository: **Contents: Read-only** (o GitHub adiciona **Metadata: Read-only** automaticamente);
   - escolha uma validade e anote quando renovar.
2. Em <https://github.com/Helio965/Helio965/settings/secrets/actions>, crie o secret **`PROFILE_STATS_TOKEN`** com o token.
3. Rode o workflow `generate profile stats` manualmente (aba Actions › Run workflow).

O token só lê commits e branches. Os logs e o `activity.json` publicam apenas totais: nomes de repositórios privados nunca aparecem. Se o token for recusado (expirado ou sem permissão), a coleta falha e os cartões publicados continuam os do último dia válido.

## Proteções contra dados parciais

- Qualquer erro de API (autenticação, limite de requisições, timeout, resposta incompleta) interrompe a coleta; nada é publicado com total parcial.
- Se o total de commits cair mais de 10% com a mesma cobertura, a coleta é recusada. Depois de apagar um repositório de propósito, rode o workflow manualmente com **allow_decrease** marcado.
- Os SVGs são conferidos antes da publicação: estrutura válida, sem cartão de erro, sem textos internos e com o mesmo total do `activity.json`.

## Testes

```bash
npm ci
npm test
```

Os testes cobrem datas e fuso, sequências de 2, 7, 15 e 30 dias (inclusive na virada de mês e de ano), deduplicação, merges, autores, erros e limites da API, os cartões (comparados byte a byte com os originais), o endpoint do 3D, o snapshot do Maeul e as verificações de publicação. `test/fixtures/real-history-2026-10-30.json` guarda a série diária real conferida com `git log` de clones completos.
