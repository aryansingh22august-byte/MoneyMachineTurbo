import React, { useState, useEffect } from 'react';

// Validate signal value against allowed set
function isValidSignal(value: any): value is 'BUY' | 'SELL' | 'HOLD' {
  return ['BUY', 'SELL', 'HOLD'].includes(value);
}
import { trpc } from '../lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { TrendingUp, TrendingDown, Minus, Star, StarOff } from 'lucide-react';

interface PennyStock {
  id: number;
  symbol: string;
  companyName: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  marketCap: number;
  peRatio: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  strength: number;
  sentimentScore: number;
  sector: string;
  isInWatchlist: boolean;
}

export function PennyStockScreener() {
  const [stocks, setStocks] = useState<PennyStock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<PennyStock[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [signalFilter, setSignalFilter] = useState<string>('all');
  const [minStrength, setMinStrength] = useState(0);
  const [maxPrice, setMaxPrice] = useState(100);

  const stocksQuery = trpc.stock.getAllStocksWithPrices.useQuery();
  const predictionsQuery = trpc.stock.getAllPredictions.useQuery();
  // getWatchlist is a protectedProcedure — it throws UNAUTHORIZED for anonymous
  // visitors. `retry: false` stops react-query from re-issuing a request that
  // can never succeed; the screener still renders, just without star state.
  const watchlistQuery = trpc.stock.getWatchlist.useQuery(undefined, { retry: false });

  const { data: stockData, refetch } = stocksQuery;
  const { data: predictions } = predictionsQuery;
  const { data: watchlist } = watchlistQuery;

  const addToWatchlistMutation = trpc.stock.addToWatchlist.useMutation();
  const removeFromWatchlistMutation = trpc.stock.removeFromWatchlist.useMutation();

  // Derived from the queries rather than a separate state flag. The previous
  // `setLoading(false)` only ran inside `if (stockData && predictions)`, so any
  // query error — or a logged-out user hitting the protected watchlist call —
  // left the spinner up forever.
  const isLoading = stocksQuery.isLoading || predictionsQuery.isLoading;
  const loadError = stocksQuery.error ?? predictionsQuery.error;

  useEffect(() => {
    if (stockData && predictions) {
      const pennyStocks: PennyStock[] = stockData
        .filter(stock => stock.lastPrice && stock.lastPrice <= maxPrice)
        .map(stock => {
          const prediction = predictions.find(p => p?.stockId === stock.id);
          const isInWatchlist = watchlist?.some(w => w.stockId === stock.id) || false;

          return {
            id: stock.id,
            symbol: stock.symbol,
            companyName: stock.companyName,
            lastPrice: stock.lastPrice || 0,
            change: stock.change || 0,
            percentChange: stock.percentChange || 0,
            volume: stock.volume || 0,
            marketCap: stock.marketCap || 0,
            peRatio: stock.peRatio || 0,
            signal: isValidSignal(prediction?.signal) ? prediction.signal : 'HOLD',
            strength: prediction?.strength || 0,
            sentimentScore: prediction?.sentimentScore || 50,
            sector: stock.sector || 'Unknown',
            isInWatchlist,
          };
        })
        .sort((a, b) => b.strength - a.strength); // Sort by signal strength

      setStocks(pennyStocks);
    }
  }, [stockData, predictions, watchlist, maxPrice]);

  useEffect(() => {
    let filtered = stocks.filter(stock =>
      stock.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      stock.symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (sectorFilter !== 'all') {
      filtered = filtered.filter(stock => stock.sector === sectorFilter);
    }

    if (signalFilter !== 'all') {
      filtered = filtered.filter(stock => stock.signal === signalFilter);
    }

    filtered = filtered.filter(stock => stock.strength >= minStrength);

    setFilteredStocks(filtered);
  }, [stocks, searchTerm, sectorFilter, signalFilter, minStrength]);

  const handleWatchlistToggle = async (stockId: number, isInWatchlist: boolean) => {
    try {
      if (isInWatchlist) {
        await removeFromWatchlistMutation.mutateAsync({ stockId });
      } else {
        await addToWatchlistMutation.mutateAsync({ stockId });
      }
      refetch();
    } catch (error) {
      console.error('Failed to update watchlist:', error);
    }
  };

  const getSignalIcon = (signal: string) => {
    switch (signal) {
      case 'BUY':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'SELL':
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      default:
        return <Minus className="w-4 h-4 text-gray-600" />;
    }
  };

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'BUY':
        return 'bg-green-100 text-green-800';
      case 'SELL':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const sectors = Array.from(new Set(stocks.map(stock => stock.sector)));

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Penny Stock Screener</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Penny Stock Screener</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load screener data: {loadError.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                stocksQuery.refetch();
                predictionsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          📈 Penny Stock Screener
          <Badge variant="secondary">{filteredStocks.length} stocks</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">Search</label>
            <Input
              placeholder="Company or symbol..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Sector</label>
            <Select value={sectorFilter} onValueChange={setSectorFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All sectors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sectors</SelectItem>
                {sectors.map(sector => (
                  <SelectItem key={sector} value={sector}>{sector}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Signal</label>
            <Select value={signalFilter} onValueChange={setSignalFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All signals" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Signals</SelectItem>
                <SelectItem value="BUY">Buy</SelectItem>
                <SelectItem value="SELL">Sell</SelectItem>
                <SelectItem value="HOLD">Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Min Strength</label>
            <Input
              type="number"
              min="0"
              max="100"
              value={minStrength}
              onChange={(e) => setMinStrength(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Max Price (₹)</label>
            <Input
              type="number"
              min="1"
              max="1000"
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Stock Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Strength</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStocks.map((stock) => (
                <TableRow key={stock.id}>
                  <TableCell className="font-medium">{stock.symbol}</TableCell>
                  <TableCell className="max-w-xs truncate" title={stock.companyName}>
                    {stock.companyName}
                  </TableCell>
                  <TableCell>₹{stock.lastPrice.toFixed(2)}</TableCell>
                  <TableCell>
                    <span className={stock.percentChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {stock.percentChange >= 0 ? '+' : ''}{stock.percentChange.toFixed(2)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={getSignalColor(stock.signal)}>
                      {getSignalIcon(stock.signal)}
                      <span className="ml-1">{stock.signal}</span>
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${stock.strength}%` }}
                        ></div>
                      </div>
                      <span className="text-sm">{stock.strength}%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            stock.sentimentScore >= 60 ? 'bg-green-600' :
                            stock.sentimentScore <= 40 ? 'bg-red-600' : 'bg-yellow-600'
                          }`}
                          style={{ width: `${stock.sentimentScore}%` }}
                        ></div>
                      </div>
                      <span className="text-sm">{stock.sentimentScore}</span>
                    </div>
                  </TableCell>
                  <TableCell>{stock.sector}</TableCell>
                  <TableCell>{stock.volume?.toLocaleString() || 'N/A'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleWatchlistToggle(stock.id, stock.isInWatchlist)}
                    >
                      {stock.isInWatchlist ? (
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      ) : (
                        <StarOff className="w-4 h-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {filteredStocks.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No penny stocks match your criteria
          </div>
        )}
      </CardContent>
    </Card>
  );
}