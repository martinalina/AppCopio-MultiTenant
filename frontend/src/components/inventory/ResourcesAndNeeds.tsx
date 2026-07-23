import React from 'react';
import { InventoryItem } from '@/types/inventory';
import { calculateNeeds, calculateTotalCategoryNeed, getPriorityColor, ItemRatio } from '@/config/inventoryRatios';
import './ResourcesAndNeeds.css';

interface ResourcesAndNeedsProps {
  inventory: { [category: string]: InventoryItem[] };
  centerCapacity: number; // Número actual de personas en el centro
  onFullnessCalculated?: (fullnessPercentage: number) => void; // Callback para enviar el porcentaje calculado
}

interface CategorySummary {
  category: string;
  currentItems: InventoryItem[];
  neededItems: ItemRatio[];
  totalCurrentQuantity: number;
  totalNeededQuantity: number;
  coveragePercentage: number;
}

const ResourcesAndNeeds: React.FC<ResourcesAndNeedsProps> = ({
  inventory,
  centerCapacity,
  onFullnessCalculated
}) => {
  // Calcular resumen por categoría
  const categorySummaries: CategorySummary[] = React.useMemo(() => {
    return Object.keys(inventory).map(category => {
      const currentItems = inventory[category] || [];
      const neededItems = calculateNeeds(centerCapacity, category, 7); // 7 días
      
      // Sumar TODAS las cantidades de items en la categoría (sin importar nombres específicos)
      const totalCurrentQuantity = currentItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
      
      // Calcular la necesidad total de la categoría
      const totalNeededQuantity = calculateTotalCategoryNeed(centerCapacity, category, 7);
      
      const coveragePercentage = totalNeededQuantity > 0 
        ? Math.min((totalCurrentQuantity / totalNeededQuantity) * 100, 100)
        : 100;

      return {
        category,
        currentItems,
        neededItems,
        totalCurrentQuantity,
        totalNeededQuantity,
        coveragePercentage
      };
    });
  }, [inventory, centerCapacity]);

  // Calcular el promedio de cobertura de todas las categorías
  const averageFullness = React.useMemo(() => {
    if (categorySummaries.length === 0) return 0;
    
    const totalPercentage = categorySummaries.reduce(
      (sum, summary) => sum + summary.coveragePercentage, 
      0
    );
    
    return Math.round(totalPercentage / categorySummaries.length);
  }, [categorySummaries]);

  // Notificar el cambio del fullness al componente padre
  React.useEffect(() => {
    if (onFullnessCalculated) {
      onFullnessCalculated(averageFullness);
    }
  }, [averageFullness, onFullnessCalculated]);

  const getCoverageStatus = (percentage: number): { text: string; color: string } => {
    if (percentage >= 80) return { text: 'Bien abastecido', color: '#4caf50' };
    if (percentage >= 50) return { text: 'Abastecimiento moderado', color: '#ff9800' };
    if (percentage >= 20) return { text: 'Abastecimiento bajo', color: '#f44336' };
    return { text: 'Crítico', color: '#d32f2f' };
  };

  return (
    <div className="resources-and-needs">
      <div className="resources-header">
        <h2>Recursos Disponibles y Necesidades</h2>
        <div className="capacity-info">
          <span>Personas actuales en el centro: <strong>{centerCapacity} personas</strong></span>
        </div>
        {categorySummaries.length > 0 && (
          <div className="overall-fullness">
            <span>Nivel de abastecimiento general del centro: </span>
            <strong style={{ 
              color: averageFullness >= 80 ? '#4caf50' : 
                     averageFullness >= 50 ? '#ff9800' : '#f44336'
            }}>
              {averageFullness}%
            </strong>
          </div>
        )}
      </div>

      <div className="categories-grid">
        {categorySummaries.map(summary => {
          const status = getCoverageStatus(summary.coveragePercentage);
          
          return (
            <div key={summary.category} className="category-card">
              <div className="category-header">
                <h3>{summary.category}</h3>
                <div 
                  className="coverage-badge"
                  style={{ backgroundColor: status.color }}
                >
                  {Math.round(summary.coveragePercentage)}%
                </div>
              </div>
              
              <div className="category-status">
                <span style={{ color: status.color }}>
                  {status.text}
                </span>
              </div>

              <div className="quantity-summary">
                <div className="quantity-item">
                  <span className="label">Disponible:</span>
                  <span className="value current">{Math.round(summary.totalCurrentQuantity)} unidades</span>
                </div>
                <div className="quantity-item">
                  <span className="label">Necesario (7 días):</span>
                  <span className="value needed">{Math.round(summary.totalNeededQuantity)} unidades</span>
                </div>
              </div>

              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ 
                    width: `${Math.min(summary.coveragePercentage, 100)}%`,
                    backgroundColor: status.color
                  }}
                />
              </div>

              <div className="items-breakdown">
                <h4>Insumos sugeridos para esta categoría:</h4>
                <p className="breakdown-note">
                  El porcentaje mostrado arriba ({Math.round(summary.coveragePercentage)}%) se calcula sobre el <strong>total de items en la categoría</strong>, 
                  sin importar los nombres específicos. A continuación se muestran cantidades sugeridas como referencia:
                </p>
                <div className="items-list">
                  {summary.neededItems.map(neededItem => {
                    const currentItem = summary.currentItems.find(
                      item => item.name.toLowerCase().includes(neededItem.name.toLowerCase())
                    );
                    const currentQuantity = currentItem?.quantity || 0;
                    const neededQuantity = neededItem.quantityPerPerson;
                    const itemCoverage = neededQuantity > 0 ? (currentQuantity / neededQuantity) * 100 : 100;
                    
                    return (
                      <div key={neededItem.name} className="item-row">
                        <div className="item-info">
                          <span className="item-name">{neededItem.name}</span>
                          <div 
                            className="priority-indicator"
                            style={{ backgroundColor: getPriorityColor(neededItem.priority) }}
                            title={`Prioridad: ${neededItem.priority}`}
                          />
                        </div>
                        <div className="item-quantities">
                          <span className="current">{currentItem ? currentQuantity : '—'}</span>
                          <span className="separator">/</span>
                          <span className="needed">{neededQuantity}</span>
                          <span className="unit">{neededItem.unit}</span>
                        </div>
                        <div className="item-coverage">
                          <span className="coverage-hint" title="Cobertura si tuvieras este item específico">
                            ({Math.round(itemCoverage)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {categorySummaries.length === 0 && (
        <div className="empty-state">
          <p>No hay información de inventario disponible para calcular necesidades.</p>
          <p>Agregue algunos insumos al inventario para ver el análisis de necesidades.</p>
        </div>
      )}
    </div>
  );
};

export default ResourcesAndNeeds;