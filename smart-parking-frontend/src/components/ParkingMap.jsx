import { CarFront, Clock3, MapPin, Wrench } from 'lucide-react';
import { formatDateTime, statusLabel } from '../lib/format';

const placeholderSpots = ['A1', 'A2', 'A3', 'A4'].map((spotName) => ({ spotName, status: 'UNKNOWN' }));

export default function ParkingMap({ parking, detailed = false }) {
  const spots = parking?.spots?.length ? parking.spots : placeholderSpots;
  return (
    <div className={`parking-map ${detailed ? 'parking-map-detailed' : ''}`}>
      <div className="parking-lane-label"><span /> LỐI DI CHUYỂN TRUNG TÂM <span /></div>
      <div className="parking-grid">
        {spots.map((spot) => {
          const status = String(spot.status || 'UNKNOWN').toLowerCase();
          return (
            <article className={`parking-space parking-${status}`} key={spot.spotName}>
              <div className="parking-space-top">
                <span className="spot-code">{spot.spotName}</span>
                <span className="space-status">{statusLabel(spot.status)}</span>
              </div>
              <div className="parking-visual">
                <span className="parking-line left" />
                {spot.status === 'OCCUPIED' ? (
                  <div className="car-shape"><CarFront size={detailed ? 46 : 38} strokeWidth={1.6} /></div>
                ) : spot.status === 'MAINTENANCE' ? (
                  <div className="car-shape maintenance"><Wrench size={detailed ? 40 : 34} /></div>
                ) : (
                  <div className="free-mark">P</div>
                )}
                <span className="parking-line right" />
              </div>
              {detailed && (
                <div className="space-meta">
                  <span><MapPin size={14} />{spot.Zone?.zoneName || 'ZONE_A'}</span>
                  <span><Clock3 size={14} />{formatDateTime(spot.lastUpdated)}</span>
                  {spot.lastDistanceCm != null && <span>Khoảng cách {spot.lastDistanceCm} cm</span>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
