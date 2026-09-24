import { Brain, LayoutDashboard, Presentation, TrendingUp, BarChart3, AlertCircle, Wrench, Radar, BarChart2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProductionDashboard from "./ProductionDashboard";
import DashboardAnalysis from "./Dashboard";
import SwarmIntelligenceRadar from "@/components/SwarmIntelligenceRadar";
import PaperTradingPage from "./PaperTradingPage";
import BacktesterPage from "./BacktesterPage";
import ScalperTerminal from "./ScalperTerminal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import UpstoxStatusButton from "@/components/UpstoxStatusButton";
import { useState, useEffect } from "react";
import { Zap } from "lucide-react";

export default function Home() {
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || "dashboard");

  useEffect(() => {
    const onHashChange = () => {
      const newTab = window.location.hash.replace('#', '');
      if (newTab) setTab(newTab);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border bg-background shadow-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-bold text-foreground">Stock Predictor Pro</span>
          </div>
          <div>
            <UpstoxStatusButton />
          </div>
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="max-w-[1600px] mx-auto py-6 px-4">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); window.location.hash = v; }} className="w-full">
          <TabsList className="mb-6 grid w-full max-w-full grid-cols-3 md:grid-cols-6 gap-3">
            <TabsTrigger value="dashboard" className="flex items-center gap-2 font-medium">
              <LayoutDashboard size={16} /> Live Dashboard
            </TabsTrigger>
            <TabsTrigger value="scalper" className="flex items-center gap-2 font-medium text-yellow-400 bg-yellow-400/5 data-[state=active]:bg-yellow-400/20 data-[state=active]:text-yellow-300">
              <Zap size={16} className="fill-yellow-400" /> Pro Algo
            </TabsTrigger>
            <TabsTrigger value="backtester" className="flex items-center gap-2 font-medium text-orange-400">
              <BarChart2 size={16} /> 📊 Backtester
            </TabsTrigger>
            <TabsTrigger value="swarm" className="flex items-center gap-2 font-medium">
              <Radar size={16} /> 🧠 Swarm AI
            </TabsTrigger>
            <TabsTrigger value="trading" className="flex items-center gap-2 font-medium text-emerald-400">
              <TrendingUp size={16} /> 📡 Live Trading
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center gap-2 font-medium">
              <Wrench size={16} /> Advanced Tools
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-0 border-none p-0 outline-none">
            <ProductionDashboard />
          </TabsContent>

          <TabsContent value="scalper" className="mt-0 border-none p-0 outline-none">
            <ScalperTerminal />
          </TabsContent>

          <TabsContent value="backtester" className="mt-0 border-none p-0 outline-none">
            <BacktesterPage />
          </TabsContent>

          <TabsContent value="swarm" className="mt-0 border-none p-0 outline-none">
            <SwarmIntelligenceRadar />
          </TabsContent>

          <TabsContent value="trading" className="mt-0 border-none p-0 outline-none">
            <PaperTradingPage />
          </TabsContent>

          <TabsContent value="tools" className="mt-0 border-none p-0 outline-none">
            <DashboardAnalysis />
          </TabsContent>

          <TabsContent value="overview">
            <OverviewContent />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}


function OverviewContent() {
  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="pt-12 text-center bg-card rounded-3xl border border-border p-12 shadow-sm">
        <h1 className="text-5xl md:text-6xl font-bold text-card-foreground mb-6">
          AI-Powered Stock Market Predictions
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Real-time analysis of Indian stocks with machine learning-based buy/sell signals, news sentiment analysis, and prediction confidence scores.
        </p>
        <div className="flex justify-center mt-4">
          <UpstoxStatusButton />
        </div>
      </div>

      {/* Features Section */}
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-8 text-center pt-8">Powerful Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <TrendingUp className="w-8 h-8 text-green-500 mb-2" />
              <CardTitle className="text-card-foreground">Real-time Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Live stock prices and market data for NSE and BSE stocks with instant updates.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <Brain className="w-8 h-8 text-blue-500 mb-2" />
              <CardTitle className="text-card-foreground">ML Predictions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Advanced machine learning models analyzing technical indicators for accurate predictions.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <BarChart3 className="w-8 h-8 text-purple-500 mb-2" />
              <CardTitle className="text-card-foreground">Sentiment Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Financial news sentiment analysis integrated with technical indicators for better signals.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <AlertCircle className="w-8 h-8 text-yellow-500 mb-2" />
              <CardTitle className="text-card-foreground">Smart Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Get notified instantly when strong buy/sell signals are detected for your watchlist.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border mt-20 pt-8 text-center text-muted-foreground text-sm">
        <p>© 2026 Stock Predictor Pro. All rights reserved. Real-time data mapped to Upstox API streams.</p>
      </footer>
    </div>
  );
}
