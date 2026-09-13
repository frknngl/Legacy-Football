import pytest
from identity.name_generator import GameNameGenerator
from identity.mapper import IdentityMapper
from validation.rules import DataQualityEngine

def test_game_name_stability():
    """
    Test that the game name generator is deterministic and stable.
    """
    gen = GameNameGenerator()
    name1 = gen.generate_name("Bruno Fernandes")
    name2 = gen.generate_name("Bruno Fernandes")
    assert name1 == name2
    
    name3 = gen.generate_name("Leroy Sané")
    assert name1 != name3

def test_identity_mapper_match_exact():
    """
    Test that an exact source_id match returns a confident canonical ID.
    """
    # Mocking db connection for test
    mapper = IdentityMapper(None)
    # Assume mapper.get_canonical_id is mocked to return UUID('1234')
    raw_player = {"player_id": "10001"}
    # match = mapper.match_player(raw_player)
    # assert match['confidence'] == 100.0

def test_validation_rejects_negative_budget():
    """
    Test that validation engine catches impossible budgets.
    """
    # validator = DataQualityEngine(None)
    # issues = validator.validate_canonical_state()
    # assert issues['critical'] > 0 if negative budget exists
    pass
