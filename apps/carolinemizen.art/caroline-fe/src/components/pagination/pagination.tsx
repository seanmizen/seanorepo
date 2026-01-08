import type { FC } from 'react';
import styled from 'styled-components';

const PaginationContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 2rem;
`;

const PaginationButton = styled.button<{ $active?: boolean }>`
  padding: 0.5rem 0.75rem;
  min-width: 2.5rem;
  background: ${(props) => (props.$active ? '#3498db' : 'white')};
  color: ${(props) => (props.$active ? 'white' : '#333')};
  border: 2px solid ${(props) => (props.$active ? '#3498db' : '#e0e0e0')};
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background: ${(props) => (props.$active ? '#2980b9' : '#f8f9fa')};
    border-color: ${(props) => (props.$active ? '#2980b9' : '#bdc3c7')};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PageInfo = styled.span`
  color: #666;
  font-size: 0.875rem;
  padding: 0 0.5rem;
`;

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const Pagination: FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
}) => {
  if (totalPages <= 1) return null;

  const pages: (number | string)[] = [];

  // Always show first page
  pages.push(1);

  // Show ellipsis or pages around current page
  if (currentPage > 3) {
    pages.push('...');
  }

  // Show pages around current page
  for (
    let i = Math.max(2, currentPage - 1);
    i <= Math.min(totalPages - 1, currentPage + 1);
    i++
  ) {
    pages.push(i);
  }

  // Show ellipsis or last page
  if (currentPage < totalPages - 2) {
    pages.push('...');
  }

  // Always show last page if there is more than one page
  if (totalPages > 1) {
    pages.push(totalPages);
  }

  return (
    <PaginationContainer>
      <PaginationButton
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        Previous
      </PaginationButton>

      {pages.map((page, index) =>
        typeof page === 'number' ? (
          <PaginationButton
            key={page}
            $active={page === currentPage}
            onClick={() => onPageChange(page)}
          >
            {page}
          </PaginationButton>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: this is the only one like this
          <PageInfo key={`ellipsis-${index}`}>{page}</PageInfo>
        ),
      )}

      <PaginationButton
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        Next
      </PaginationButton>
    </PaginationContainer>
  );
};
