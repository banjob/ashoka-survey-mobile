//A single survey
function SurveyShowView(surveyID) {
	var _ = require('lib/underscore')._;
	var Survey = require('models/survey');
	var Question = require('models/question');
	var convertSurveyDataForTable = function() {
		//var questions = Question.findBy('survey_id', surveyID);
		var attrs = _(Survey.all()).find(function(survey) {
			return survey.id == surveyID
		});
		return [{
			header : 'Name',
			title : attrs['name']
		}, {
			header : 'Description',
			title : attrs['description']
		}, {
			header : 'Expires On',
			title : attrs['expiry_date']
		}];
	}
	
	self = Ti.UI.createView({
		layout : 'vertical'
	});

	// now assign that array to the table's data property to add those objects as rows
	var table = Titanium.UI.createTableView({
		data : convertSurveyDataForTable(),
		style : Titanium.UI.iPhone.TableViewStyle.GROUPED
	});

	self.add(table);

	return self;
}

module.exports = SurveyShowView;
