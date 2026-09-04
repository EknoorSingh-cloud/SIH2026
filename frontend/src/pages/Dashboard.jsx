import Sidebar from "../components/Sidebar";
import {
  FileText,
  Users,
  Upload,
  ShieldCheck,
  Bell,
  ArrowUpRight,
} from "lucide-react";

function Dashboard() {
  const stats = [
    {
      title: "Total Documents",
      value: "124",
      icon: <FileText size={24} />,
    },
    {
      title: "Active Users",
      value: "18",
      icon: <Users size={24} />,
    },
    {
      title: "Uploaded Today",
      value: "12",
      icon: <Upload size={24} />,
    },
    {
      title: "Security Status",
      value: "Secure",
      icon: <ShieldCheck size={24} />,
    },
  ];

  const documents = [
    {
      name: "Legal_Contract.pdf",
      type: "PDF Document",
      date: "Today, 10:32 AM",
    },
    {
      name: "Client_Agreement.pdf",
      type: "PDF Document",
      date: "Yesterday",
    },
    {
      name: "Case_Document.docx",
      type: "Word Document",
      date: "2 days ago",
    },
    {
      name: "Financial_Report.pdf",
      type: "PDF Document",
      date: "3 days ago",
    },
  ];

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        <div className="page-header">
          <div>
            <h1>Dashboard</h1>
            <p>Welcome back. Here's what's happening today.</p>
          </div>

          <Bell size={22} />
        </div>

        <div className="stats-grid">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.title}>
              <div className="stat-icon">
                {stat.icon}
              </div>

              <div>
                <h3>{stat.value}</h3>
                <p>{stat.title}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="recent-section">
          <div className="section-header">
            <h2>Recent Documents</h2>
            <span>View All</span>
          </div>

          <div className="document-list">
            {documents.map((doc) => (
              <div className="document-item" key={doc.name}>
                <div className="document-icon">
                  <FileText size={22} />
                </div>

                <div className="document-info">
                  <h4>{doc.name}</h4>
                  <p>
                    {doc.type} • {doc.date}
                  </p>
                </div>

                <ArrowUpRight size={20} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;