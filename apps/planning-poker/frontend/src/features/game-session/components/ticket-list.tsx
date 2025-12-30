import {
  Add,
  CheckCircle,
  Close,
  Delete,
  Done,
  Edit,
  ExpandMore,
} from '@mui/icons-material';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  TextField,
  Typography,
} from '@mui/material';
import { type FC, useEffect, useRef, useState } from 'react';

type Ticket = {
  id: number;
  title: string;
  estimate: string | null;
};

type VotesData = {
  votes: { attendeeId: string; hasVoted: boolean; vote: string | null }[];
  revealed: boolean;
};

type TicketListProps = {
  tickets: Ticket[];
  currentIndex: number;
  ticketVotesMap: Map<number, VotesData | undefined>;
  onSelectTicket: (index: number) => void;
  onAddTicket: (title: string) => void;
  onDeleteTicket: (id: number) => void;
  onUpdateTicketTitle: (id: number, title: string) => void;
  isAdding: boolean;
  setIsAdding: (isAdding: boolean) => void;
};

const TicketList: FC<TicketListProps> = ({
  tickets,
  currentIndex,
  ticketVotesMap,
  onSelectTicket,
  onAddTicket,
  onDeleteTicket,
  onUpdateTicketTitle,
  isAdding,
  setIsAdding,
}) => {
  const [newTicketTitle, setNewTicketTitle] = useState('');
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const listItemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const newTicketInputRef = useRef<HTMLInputElement | null>(null);
  const shouldScrollToNewTicketRef = useRef(false);

  // Scroll to newly added ticket (only for local user)
  useEffect(() => {
    if (!shouldScrollToNewTicketRef.current) return;
    shouldScrollToNewTicketRef.current = false;

    const lastTicketIndex = tickets.length - 1;
    if (lastTicketIndex >= 0) {
      listItemRefs.current[lastTicketIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }

    if (isAdding) {
      newTicketInputRef.current?.focus();
    }
  }, [tickets.length, isAdding]);

  // Scroll and focus when entering add mode
  useEffect(() => {
    if (isAdding) {
      newTicketInputRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
      newTicketInputRef.current?.focus();
    }
  }, [isAdding]);

  const handleAdd = () => {
    const title = newTicketTitle.trim();
    if (!title) return;

    shouldScrollToNewTicketRef.current = true;
    onAddTicket(title);
    setNewTicketTitle('');
  };

  const handleStartEdit = (ticket: Ticket) => {
    setEditingTicketId(ticket.id);
    setEditingTitle(ticket?.title || '');
  };

  const handleSubmitEdit = () => {
    if (editingTicketId && editingTitle.trim()) {
      onUpdateTicketTitle(editingTicketId, editingTitle);
    }
    setEditingTicketId(null);
    setEditingTitle('');
  };

  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="h6">Tickets ({tickets.length})</Typography>
      </AccordionSummary>
      <AccordionDetails
        sx={{
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 360,
        }}
      >
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <List>
            {tickets.map((ticket, index) => {
            const votesData = ticketVotesMap.get(ticket.id);
            const voteCount =
              votesData?.votes.filter((v) => v.hasVoted).length || 0;
            const isEditing = editingTicketId === ticket.id;

            return (
              <ListItem
                key={ticket.id}
                disablePadding
                ref={(el) => {
                  listItemRefs.current[index] = el;
                }}
              >
                <ListItemButton
                  selected={index === currentIndex}
                  onClick={() => !isEditing && onSelectTicket(index)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 1.5,
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    {isEditing ? (
                      <TextField
                        variant="standard"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSubmitEdit();
                          if (e.key === 'Escape') {
                            setEditingTicketId(null);
                            setEditingTitle('');
                          }
                        }}
                        onBlur={() => {
                          setEditingTicketId(null);
                          setEditingTitle('');
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        fullWidth
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '1rem',
                          },
                        }}
                      />
                    ) : (
                      <Typography
                        variant="body1"
                        noWrap
                        sx={{
                          direction: 'rtl',
                          textAlign: 'left',
                        }}
                      >
                        {/* RTL hijinks: replace trailing slashes */}
                        {ticket?.title?.replace(/\/$/g, '')}
                      </Typography>
                    )}
                    <Box
                      sx={{
                        display: 'flex',
                        gap: 2,
                        mt: 0.5,
                        flexWrap: 'wrap',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {voteCount} votes cast
                      </Typography>
                      {ticket.estimate && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          <Typography variant="caption" color="success.main">
                            Final estimate:
                            {ticket.estimate}
                          </Typography>
                          <CheckCircle color="success" sx={{ fontSize: 14 }} />
                        </Box>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {isEditing ? (
                      <IconButton
                        size="small"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSubmitEdit();
                        }}
                        color="primary"
                      >
                        <Done />
                      </IconButton>
                    ) : (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(ticket);
                        }}
                      >
                        <Edit />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTicket(ticket.id);
                      }}
                    >
                      <Delete />
                    </IconButton>
                  </Box>
                </ListItemButton>
              </ListItem>
            );
          })}
          </List>
        </Box>
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          {isAdding ? (
            <ListItem
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  if (newTicketTitle.trim()) {
                    handleAdd();
                  } else {
                    setIsAdding(false);
                  }
                }
              }}
            >
              <TextField
                fullWidth
                size="small"
                autoFocus
                inputRef={newTicketInputRef}
                value={newTicketTitle}
                onChange={(e) => setNewTicketTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') setIsAdding(false);
                }}
                placeholder="Ticket title"
              />{' '}
              <IconButton onClick={handleAdd} color="primary">
                <Done />
              </IconButton>
              <IconButton onClick={() => setIsAdding(false)}>
                <Close />
              </IconButton>
            </ListItem>
          ) : (
            <ListItem>
              <Button
                fullWidth
                startIcon={<Add />}
                onClick={() => setIsAdding(true)}
              >
                Add Ticket
              </Button>
            </ListItem>
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export { TicketList };
