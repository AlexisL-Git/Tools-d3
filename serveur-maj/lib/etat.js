'use strict';

// Sans confiance dans ce qui arrive: ces trois bornes s'appliquent avant
// toute requete. Un client bavard ou forge ne doit pas pouvoir remplir la
// base ni faire echouer l'appel — il est tronque, en silence, avec un 200.
const MAX_JOURNAL = 4000;
const MAX_REFUS = 10;
const FORMAT_VERSION = /^[0-9][0-9.]{0,19}$/;

function versionValide(v) {
  return typeof v === 'string' && FORMAT_VERSION.test(v);
}

async function enregistrerEtat(sql, { cle, version, refus }) {
  const v = versionValide(version) ? version : null;
  // COALESCE: une version illisible ne doit pas EFFACER la derniere version
  // connue. Ne rien savoir vaut mieux que remplacer un fait par un blanc.
  await sql`UPDATE amis SET version_vue = COALESCE(${v}, version_vue) WHERE cle = ${cle}`;
  // Une ligne de lancements ne compte que si une version a ete chargee. Le
  // chemin 'arreter' (coupe-circuit, aucune version) signale quand meme,
  // pour ne pas perdre un refus en attente, mais ce n'est pas un lancement:
  // sans ce garde-fou, chaque relance pendant un coupe-circuit gonflerait
  // la colonne "30 j" avec des arrets.
  if (v !== null) {
    await sql`INSERT INTO lancements (cle, version) VALUES (${cle}, ${v})`;
  }

  const nouveaux = [];
  const liste = Array.isArray(refus) ? refus.slice(0, MAX_REFUS) : [];
  for (const r of liste) {
    if (!r || !versionValide(r.version)) continue;
    const journal = typeof r.journal === 'string' ? r.journal.slice(0, MAX_JOURNAL) : null;
    // ON CONFLICT DO NOTHING ... RETURNING: postgres arbitre le doublon en une
    // seule requete, et nous dit s'il a insere. C'est ce booleen, et lui seul,
    // qui declenchera le ping Discord — la file du client renvoie le meme
    // refus tant qu'elle n'a pas eu son 200.
    const inserees = await sql`INSERT INTO refus (cle, version, journal)
              VALUES (${cle}, ${r.version}, ${journal})
              ON CONFLICT (cle, version) DO NOTHING
              RETURNING version`;
    if (inserees.length) nouveaux.push(r.version);
  }
  return { ok: true, nouveaux };
}

async function compterLancements(sql, { jours = 30 } = {}) {
  // make_interval prend un parametre; '30 days' concatene n'en prendrait pas.
  return sql`SELECT cle, COUNT(*)::int AS n FROM lancements
             WHERE au > now() - make_interval(days => ${jours})
             GROUP BY cle`;
}

async function lancementsDe(sql, cle, limite = 20) {
  const n = Math.min(Math.max(parseInt(limite, 10) || 20, 1), 100);
  return sql`SELECT version, au FROM lancements
             WHERE cle = ${cle} ORDER BY au DESC LIMIT ${n}`;
}

async function listerRefus(sql) {
  return sql`SELECT r.cle, a.nom, r.version, r.journal, r.signale_le
             FROM refus r LEFT JOIN amis a ON a.cle = r.cle
             ORDER BY r.signale_le DESC LIMIT 50`;
}

async function purgerLancements(sql, jours = 90) {
  const lignes = await sql`DELETE FROM lancements
                           WHERE au < now() - make_interval(days => ${jours})
                           RETURNING id`;
  return lignes.length;
}

module.exports = {
  enregistrerEtat, compterLancements, lancementsDe, listerRefus, purgerLancements,
  MAX_JOURNAL, MAX_REFUS,
};
