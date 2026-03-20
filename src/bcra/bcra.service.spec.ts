import { Test, TestingModule } from '@nestjs/testing';
import { BcraService } from './bcra.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BcraService', () => {
  let service: BcraService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BcraService],
    }).compile();

    service = module.get<BcraService>(BcraService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fetchBCRAStatus', () => {
    it('should return null if no results', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { results: null } });
      const result = await service.fetchBCRAStatus('20123456789');
      expect(result).toBeNull();
    });

    it('should return status if data exists', async () => {
      const mockData = {
        results: {
          denominacion: 'TEST USER',
          periodos: [{
            entidades: [{ entidad: 'BANK A', situacion: 1, monto: 100 }]
          }]
        }
      };
      mockedAxios.get.mockResolvedValueOnce({ data: mockData });
      const result = await service.fetchBCRAStatus('20123456789');
      expect(result).toEqual({
        denominacion: 'TEST USER',
        entidades: [{ entidad: 'BANK A', situacion: 1, monto: 100 }]
      });
    });
  });

  describe('hasStatusChanged', () => {
    it('should return false if status is same', () => {
      const status = { entidades: [{ entidad: 'BANK A', situacion: 1, monto: 100 }] };
      expect(service.hasStatusChanged(status, status)).toBe(false);
    });

    it('should return true if status changed', () => {
      const oldStatus = { entidades: [{ entidad: 'BANK A', situacion: 1, monto: 100 }] };
      const newStatus = { entidades: [{ entidad: 'BANK A', situacion: 2, monto: 100 }] };
      expect(service.hasStatusChanged(oldStatus, newStatus)).toBe(true);
    });
  });
});
