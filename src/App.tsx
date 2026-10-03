import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./pages/Home";
import { Receive } from "./pages/Receive";
import { Send } from "./pages/Send";
import { Expired } from "./pages/Expired";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { useI18n } from "./i18n";

export function App() {
  const { t } = useI18n();
  return (
    <Layout>
      <ErrorBoundary fallbackMessage={t("errors.UNKNOWN")} retryLabel={t("common.retry")}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="/r/:token" element={<Send />} />
          <Route path="/expired" element={<Expired />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<Expired />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  );
}
