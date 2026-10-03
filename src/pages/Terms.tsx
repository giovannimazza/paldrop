import { LegalPage } from "./Privacy";
import type { TKey } from "../i18n";

const SECTIONS: { title: TKey; body: TKey }[] = [
  { title: "terms.p1title", body: "terms.p1" },
  { title: "terms.p2title", body: "terms.p2" },
  { title: "terms.p3title", body: "terms.p3" },
  { title: "terms.p4title", body: "terms.p4" },
];

export function Terms() {
  return <LegalPage titleKey="terms.title" introKey="terms.intro" sections={SECTIONS} />;
}
