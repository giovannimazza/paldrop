import { useI18n, type TKey } from "../i18n";

type Section = { title: TKey; body: TKey };

const SECTIONS: Section[] = [
  { title: "privacy.p1title", body: "privacy.p1" },
  { title: "privacy.p2title", body: "privacy.p2" },
  { title: "privacy.p3title", body: "privacy.p3" },
  { title: "privacy.p4title", body: "privacy.p4" },
];

export function LegalPage({
  titleKey,
  introKey,
  sections,
}: {
  titleKey: TKey;
  introKey: TKey;
  sections: Section[];
}) {
  const { t } = useI18n();
  return (
    <section className="page legal-page">
      <h1 className="page-title">{t(titleKey)}</h1>
      <p className="lead">{t(introKey)}</p>
      {sections.map((section) => (
        <article key={section.title} className="panel legal-panel">
          <h2 className="panel-title">{t(section.title)}</h2>
          <p className="panel-text">{t(section.body)}</p>
        </article>
      ))}
    </section>
  );
}

export function Privacy() {
  return (
    <LegalPage titleKey="privacy.title" introKey="privacy.intro" sections={SECTIONS} />
  );
}
