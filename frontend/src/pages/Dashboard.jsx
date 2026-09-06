import Sidebar from "../components/Sidebar";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Users,
  Upload,
  ShieldCheck,
  Bell,
  ArrowUpRight,
  Clock,
  Plus,
  Search,
  FolderOpen,
} from "lucide-react";

function Dashboard() {
  const navigate = useNavigate();

  const stats = [
    {
      title: "Total Documents",
      value: "124",
      change: "+12%",
      icon: <FileText size={24} />,
    },
    {
      title: "Active Users",
      value: "18",
      change: "+8%",
      icon: <Users size={24} />,
    },
    {
      title: "Uploaded Today",
      value: "12",
      change: "+24%",
      icon: <Upload size={24} />,
    },
    {
      title: "Security Status",
      value: "Secure",
      change: "Protected",
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
      date: "Today, 9:15 AM",
    },
    {
      name: "Case_Document.docx",
      type: "Word Document",
      date: "Yesterday",
    },
    {
      name: "Financial_Report.pdf",
      type: "PDF Document",
      date: "2 days ago",
    },
  ];

  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        {/* HEADER */}
        <div className="dashboard-topbar">
          <div>
            <p className="dashboard-greeting">
              Welcome back 👋
            </p>

            <h1>Dashboard Overview</h1>

            <p className="dashboard-subtitle">
              Manage, organize and protect your secure documents.
            </p>
          </div>

          <div className="dashboard-actions">
            <button
              className="notification-button"
              title="Notifications"
              type="button"
            >
              <Bell size={20} />
              <span className="notification-dot"></span>
            </button>

            <button
              className="primary-button"
              onClick={() => navigate("/upload")}
              type="button"
            >
              <Plus size={18} />
              Upload Document
            </button>
          </div>
        </div>

        {/* STATS */}
        <section className="stats-grid">
          {stats.map((stat) => (
            <div
              className="stat-card premium-stat"
              key={stat.title}
            >
              <div className="stat-card-top">
                <div className="stat-icon">
                  {stat.icon}
                </div>

                <span className="stat-change">
                  {stat.change}
                </span>
              </div>

              <div className="stat-content">
                <h3>{stat.value}</h3>
                <p>{stat.title}</p>
              </div>
            </div>
          ))}
        </section>

        {/* QUICK ACTIONS */}
        <section className="dashboard-section">
          <div className="section-title">
            <h2>Quick Actions</h2>

            <p>
              Quickly access important document management features.
            </p>
          </div>

          <div className="quick-actions-grid">
            <button
              className="quick-action-card"
              onClick={() => navigate("/upload")}
              type="button"
            >
              <div className="quick-action-icon">
                <Upload size={22} />
              </div>

              <div>
                <h3>Upload Document</h3>
                <p>Add a new secure document</p>
              </div>

              <ArrowUpRight size={20} />
            </button>

            <button
              className="quick-action-card"
              onClick={() => navigate("/documents")}
              type="button"
            >
              <div className="quick-action-icon">
                <FolderOpen size={22} />
              </div>

              <div>
                <h3>View Documents</h3>
                <p>Manage all your documents</p>
              </div>

              <ArrowUpRight size={20} />
            </button>

            <button
              className="quick-action-card"
              onClick={() => navigate("/search")}
              type="button"
            >
              <div className="quick-action-icon">
                <Search size={22} />
              </div>

              <div>
                <h3>Search Documents</h3>
                <p>Find documents quickly</p>
              </div>

              <ArrowUpRight size={20} />
            </button>
          </div>
        </section>

        {/* RECENT DOCUMENTS */}
        <section className="recent-section premium-recent-section">
          <div className="section-header">
            <div>
              <h2>Recent Documents</h2>

              <p>
                Your latest uploaded and updated documents.
              </p>
            </div>

            <button
              className="view-all-button"
              onClick={() => navigate("/documents")}
              type="button"
            >
              View All
              <ArrowUpRight size={17} />
            </button>
          </div>

          <div className="document-list">
            {documents.map((doc) => (
              <button
                className="document-item"
                key={doc.name}
                onClick={() => navigate("/documents")}
                type="button"
              >
                <div className="document-icon">
                  <FileText size={22} />
                </div>

                <div className="document-info">
                  <h4>{doc.name}</h4>
                  <p>{doc.type}</p>
                </div>

                <div className="document-date">
                  <Clock size={15} />
                  <span>{doc.date}</span>
                </div>

                <ArrowUpRight
                  className="document-arrow"
                  size={20}
                />
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;