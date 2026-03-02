import { Course, ContentType } from './types';

export const SAMPLE_COURSE: Course = {
  title: "Network Security Fundamentals",
  description: "A comprehensive guide to securing modern enterprise networks using industry-standard protocols and best practices.",
  modules: [
    {
      id: "mod-1",
      title: "Threat Landscape & Defense",
      description: "Understanding common attack vectors and the layered defense approach.",
      status: "completed",
      isLocked: false,
      isCompleted: false,
      steps: [
        {
          id: "step-1-1",
          title: "Introduction to Cyber Threats",
          type: ContentType.TEXT,
          status: "completed",
          content: {
            type: ContentType.TEXT,
            title: "Introduction to Cyber Threats",
            lessonText: "Before diving into defense, we must understand the primary motivations and methods used by modern adversaries.",
            data: {
              content: "### The Modern Threat Landscape\n\nIn today's interconnected world, threats come from various sources:\n\n*   **State-Sponsored Actors:** Highly sophisticated, targeting critical infrastructure.\n*   **Cybercriminals:** Motivated by financial gain through ransomware and data theft.\n*   **Hacktivists:** Driven by political or social agendas.\n*   **Insiders:** Employees or partners with authorized access who misuse it.\n\n**Key Attack Vectors:**\n1.  **Phishing:** Deceptive emails to steal credentials.\n2.  **Malware:** Malicious software like viruses and worms.\n3.  **DDoS:** Overwhelming services to make them unavailable."
            }
          }
        },
        {
          id: "step-1-2",
          title: "Security Architecture Components",
          type: ContentType.HOTSPOT,
          status: "completed",
          content: {
            type: ContentType.HOTSPOT,
            title: "Security Architecture Components",
            lessonText: "Explore the core components that make up a resilient security architecture.",
            data: {
              points: [
                { title: "Firewall", icon: "Shield", content: "The first line of defense, filtering traffic based on security rules." },
                { title: "IDS/IPS", icon: "Activity", content: "Monitors network traffic for suspicious activity and known threats." },
                { title: "SIEM", icon: "Database", content: "Aggregates and analyzes log data from across the network for real-time monitoring." }
              ]
            }
          }
        },
        {
          id: "step-1-3",
          title: "Knowledge Check",
          type: ContentType.QUIZ,
          status: "completed",
          content: {
            type: ContentType.QUIZ,
            title: "Knowledge Check",
            lessonText: "Let's verify your understanding of the core concepts covered so far.",
            data: {
              questions: [
                {
                  question: "Which component is primarily responsible for real-time log analysis and alerting?",
                  options: ["Firewall", "IDS", "SIEM", "VPN"],
                  correctAnswer: 2,
                  explanation: "SIEM (Security Information and Event Management) tools aggregate and analyze logs to provide real-time visibility and alerting."
                },
                {
                  question: "What is the primary goal of a DDoS attack?",
                  options: ["Steal Data", "Encrypt Files", "Service Disruption", "Phishing"],
                  correctAnswer: 2,
                  explanation: "Distributed Denial of Service (DDoS) attacks aim to make a service unavailable by overwhelming it with traffic."
                },
                {
                  question: "Which threat actor is typically motivated by financial gain?",
                  options: ["Hacktivists", "Cybercriminals", "State-Actors", "Script Kiddies"],
                  correctAnswer: 1,
                  explanation: "Cybercriminals are primarily motivated by profit, often using ransomware or selling stolen data."
                },
                {
                  question: "What does IPS stand for in network security?",
                  options: ["Internet Protocol Suite", "Intrusion Prevention System", "Internal Power Supply", "Identity Protection Service"],
                  correctAnswer: 1,
                  explanation: "IPS stands for Intrusion Prevention System, which actively blocks detected threats."
                }
              ]
            }
          }
        }
      ]
    },
    {
      id: "mod-2",
      title: "Access Control & Identity",
      description: "Implementing Zero Trust and robust authentication mechanisms.",
      status: "pending",
      isLocked: true,
      isCompleted: false,
      steps: []
    }
  ]
};
