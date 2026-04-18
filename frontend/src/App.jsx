import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Observe from './pages/Observe'

/**
 * App — the root component. React Router handles navigation.
 *
 * All routes under /app/* are React pages.
 * /api/* goes to Flask (handled by Vite proxy in dev, Flask in prod).
 * /prototypes/* still serves vanilla JS (handled by Flask).
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/app" element={<Home />} />
        <Route path="/app/observe" element={<Observe />} />
        {/* Phase 3: Team + Profile */}
        {/* <Route path="/app/team" element={<Team />} /> */}
        {/* <Route path="/app/staff/:email" element={<StaffProfile />} /> */}
        {/* Phase 4: Insights */}
        {/* <Route path="/app/insights" element={<Insights />} /> */}
        {/* Phase 5: Network */}
        {/* <Route path="/app/network" element={<Network />} /> */}
      </Routes>
    </BrowserRouter>
  )
}
