import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { I18nProvider, useI18n } from "./i18n";
import { Layout } from "./components/Layout";
import { App } from "./App";
import "./index.css";

function SetupNotice() {
  const { t } = useI18n();
  return (
    <Layout>
      <section className="page center-page">
        <div className="panel">
          <p className="panel-title">{t("setup.title")}</p>
          <p className="panel-text">{t("setup.body")}</p>
        </div>
      </section>
    </Layout>
  );
}

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root element");
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {convexUrl ? (
          <ConvexProvider client={new ConvexReactClient(convexUrl)}>
            <App />
          </ConvexProvider>
        ) : (
          <SetupNotice />
        )}
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>
);
