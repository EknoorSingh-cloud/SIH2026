import { Routes, Route } from "react-router-dom";

import Login from "./pages/Login";
import MFA from "./pages/MFA";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import Upload from "./pages/Upload";
import Search from "./pages/Search";
import Users from "./pages/Users";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />

      {/* Authentication */}
      <Route path="/mfa" element={<MFA />} />

      {/* Application */}
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/documents" element={<Documents />} />
      <Route path="/upload" element={<Upload />} />
      <Route path="/search" element={<Search />} />
      <Route path="/users" element={<Users />} />
    </Routes>
  );
}

export default App;