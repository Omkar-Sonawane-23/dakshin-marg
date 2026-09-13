import { Router } from 'express';

export const vesselsRouter = Router();

const VESSELS = [
  { id:'VSL-01', name:'RSV Dakshin Dhruv', callsign:'ATVK', type:'RESEARCH', iceClass:'PC5', draftM:8.2, beamM:22.4, lengthM:122, installedPowerKw:8500, maxSpeedKn:16.5, cruiseSpeedKn:12.5, fuelCapacityT:1200, turningRadiusNm:0.8, reserveFuelPct:20, maxIceConcPct:70, status:'OPERATIONAL' },
  { id:'VSL-02', name:'IBV Himadri', callsign:'ATVM', type:'ICEBREAKER', iceClass:'PC3', draftM:9.1, beamM:26.0, lengthM:138, installedPowerKw:18000, maxSpeedKn:18.0, cruiseSpeedKn:13.0, fuelCapacityT:1800, turningRadiusNm:1.1, reserveFuelPct:25, maxIceConcPct:90, status:'OPERATIONAL' },
  { id:'VSL-03', name:'MV Priyadarshini', callsign:'ATVP', type:'SUPPLY', iceClass:'PC7', draftM:7.4, beamM:20.1, lengthM:105, installedPowerKw:5200, maxSpeedKn:14.2, cruiseSpeedKn:11.0, fuelCapacityT:900, turningRadiusNm:0.6, reserveFuelPct:15, maxIceConcPct:50, status:'OPERATIONAL' },
  { id:'VSL-04', name:'RV Sagarnidhi II', callsign:'ATVS', type:'RESEARCH', iceClass:'IA', draftM:6.8, beamM:18.5, lengthM:98, installedPowerKw:4200, maxSpeedKn:13.5, cruiseSpeedKn:10.5, fuelCapacityT:650, turningRadiusNm:0.5, reserveFuelPct:15, maxIceConcPct:35, status:'OPERATIONAL' },
  { id:'VSL-05', name:'MT Varuna', callsign:'ATVT', type:'TANKER', iceClass:'NONE', draftM:8.0, beamM:24.0, lengthM:115, installedPowerKw:6000, maxSpeedKn:15.0, cruiseSpeedKn:12.0, fuelCapacityT:2200, turningRadiusNm:0.9, reserveFuelPct:15, maxIceConcPct:10, status:'OPERATIONAL' },
];

vesselsRouter.get('/', (_req, res) => {
  res.json({ vessels: VESSELS, count: VESSELS.length, provenance:'SAMPLE_DATA', note:'Sample vessel profiles for demonstration. Provide validated power/fuel curves to enable fuel estimates.' });
});

vesselsRouter.get('/:id', (req, res) => {
  const v = VESSELS.find(x=>x.id===req.params.id);
  if(!v) { res.status(404).json({ detail:{ code:'NOT_FOUND', message:'No such vessel.' }}); return; }
  res.json({ vessel: v });
});
